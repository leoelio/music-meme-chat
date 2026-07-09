import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowCounterClockwise,
  BookmarkSimple,
  ChatCircleDots,
  Check,
  CloudArrowUp,
  DotsThree,
  FolderOpen,
  GlobeHemisphereEast,
  Heart,
  MagnifyingGlass,
  Microphone,
  MusicNotes,
  Pause,
  Play,
  Plus,
  Scissors,
  ShareFat,
  Smiley,
  SpeakerHigh,
  ThumbsUp,
  X,
} from '@phosphor-icons/react';
import matchSendIcon from './assets/match-send.svg';
import matchToggleIcon from './assets/match-toggle.svg';
import { categories, tracks as baseTracks } from './data/tracks.js';
import { audioBufferToMp3Blob, audioBufferToWavBlob, blobToDataUrl, decodeAudioFile, formatSeconds, initialSegments, inspectAudioFile, renderEditedAudio, spectrumSummary, waveformSummary } from './utils/audioClip.js';
import { findTrackMatches, percent } from './utils/match.js';

const storageKeys = {
  favorites: 'geng-world.favorite-track-ids',
  customTracks: 'geng-world.custom-tracks',
};

const seedMessages = [
  { id: 'm1', type: 'text', side: 'friend', text: '我们等会儿直接出发？', time: '15:34' },
];

const initialPosts = [
  {
    id: 'p1',
    friend: true,
    author: '林小鹿',
    time: '2 分钟前',
    visibility: '好友可见',
    text: '这句“出发喽”终于有配乐了',
    trackId: 'go-go-cortis',
    likes: 42,
    type: 'share',
  },
  {
    id: 'p2',
    friend: false,
    author: '不熬夜研究员',
    time: '12 分钟前',
    visibility: '公开',
    text: '原创投稿：无语的停顿，适合冷场和省略号。',
    trackId: 'track-131b9sk',
    likes: 18,
    type: 'original',
  },
];

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function byId(tracks, id) {
  return tracks.find((track) => track.id === id) || tracks[0];
}

function messageTimeMs(message) {
  if (typeof message.sentAt === 'number') return message.sentAt;
  const match = /^(\d{1,2}):(\d{2})$/.exec(message.time || '');
  if (!match) return null;
  return (Number(match[1]) * 60 + Number(match[2])) * 60 * 1000;
}

function shouldShowMessageTime(message, previousMessage) {
  if (!previousMessage) return Boolean(message.time);
  const current = messageTimeMs(message);
  const previous = messageTimeMs(previousMessage);
  if (current === null || previous === null) return false;
  let diff = current - previous;
  if (diff < 0) diff += 24 * 60 * 60 * 1000;
  return diff > 5 * 60 * 1000;
}

function preferredTracks(tracks, ids) {
  const found = ids.map((id) => byId(tracks, id)).filter(Boolean);
  return [...new Map(found.map((track) => [track.id, track])).values()];
}

function App() {
  const [screen, setScreen] = useState('chat');
  const [lastWorldScreen, setLastWorldScreen] = useState('discover');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState(seedMessages);
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [hiddenPreviewDraft, setHiddenPreviewDraft] = useState('');
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState(() => readJson(storageKeys.favorites, []));
  const [customTracks, setCustomTracks] = useState(() => readJson(storageKeys.customTracks, []));
  const [usageByTrack, setUsageByTrack] = useState({});
  const [playingKey, setPlayingKey] = useState('');
  const [friendOnly, setFriendOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('全部');
  const [posts, setPosts] = useState(initialPosts);
  const [publishOpen, setPublishOpen] = useState(false);
  const [toast, setToast] = useState('');
  const audioRef = useRef(null);
  const longPressTimer = useRef(null);

  function goScreen(nextScreen) {
    if (nextScreen === 'world') {
      setScreen(lastWorldScreen);
      return;
    }
    if (nextScreen === 'discover' || nextScreen === 'square') {
      setLastWorldScreen(nextScreen);
    }
    setScreen(nextScreen);
  }

  function goWorld() {
    setScreen(lastWorldScreen);
  }

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const tracks = useMemo(
    () => [
      ...baseTracks,
      ...customTracks,
    ].map((track) => ({ ...track, isFavorite: favoriteSet.has(track.id) })),
    [customTracks, favoriteSet],
  );

  const draftKey = draft.trim();
  const candidates = useMemo(() => {
    if (!draftKey || hiddenPreviewDraft === draftKey) return [];
    return findTrackMatches(draft, tracks, usageByTrack, favoriteIds);
  }, [draft, draftKey, favoriteIds, hiddenPreviewDraft, tracks, usageByTrack]);
  const match = candidates.find((track) => track.id === selectedMatchId) || candidates[0] || null;

  const featured = preferredTracks(tracks, [
    'go-go-cortis',
    'i-am-rich-man-rich-man-aespa',
    'sorry-sorry-sorry-sorry-super-junior',
  ]);
  const playlistTracks = preferredTracks(tracks, ['dun-dun-filthy-gears', 'taxi-driver-edition', 'out--bgm']);
  const libraryTracks = tracks.filter((track) => {
    const text = `${track.title} ${track.artist} ${track.genre} ${track.triggers.join(' ')}`.toLowerCase();
    const matchQuery = !query.trim() || text.includes(query.trim().toLowerCase());
    const matchCategory = activeFilter === '全部' || track.categories?.includes(activeFilter) || track.category === activeFilter;
    return matchQuery && matchCategory;
  });

  useEffect(() => saveJson(storageKeys.favorites, favoriteIds), [favoriteIds]);
  useEffect(() => saveJson(storageKeys.customTracks, customTracks), [customTracks]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onEnded = () => setPlayingKey('');
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, []);

  function flash(message) {
    setToast(message);
    window.clearTimeout(flash.timer);
    flash.timer = window.setTimeout(() => setToast(''), 1800);
  }

  function updateDraft(value) {
    setDraft(value);
    setSelectedMatchId('');
    setCandidateOpen(false);
    if (hiddenPreviewDraft) setHiddenPreviewDraft('');
  }

  function toggleFavorite(track) {
    if (!track?.id) return;
    setFavoriteIds((current) =>
      current.includes(track.id) ? current.filter((id) => id !== track.id) : [track.id, ...current],
    );
    flash(favoriteSet.has(track.id) ? '已移出梗库' : '已加入我的梗库');
  }

  function recordUsage(track) {
    if (!track?.id) return;
    setUsageByTrack((current) => ({ ...current, [track.id]: (current[track.id] || 0) + 1 }));
  }

  function playTrack(track, key) {
    const audio = audioRef.current;
    if (!track || !audio) return;
    if (playingKey === key && !audio.paused) {
      audio.pause();
      setPlayingKey('');
      return;
    }
    audio.src = track.audioUrl;
    audio.play().then(() => {
      setPlayingKey(key);
      recordUsage(track);
    }).catch(() => flash('浏览器阻止了播放，请再点一次'));
  }

  function sendMusic(track = match) {
    if (!track) return;
    const sentAt = Date.now();
    setMessages((current) => [
      ...current,
      {
        id: `voice-${Date.now()}`,
        type: 'voice',
        side: 'me',
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        audioUrl: track.audioUrl,
        duration: track.duration,
        score: track.score,
        time: nowTime(),
        sentAt,
      },
    ]);
    recordUsage(track);
    setHiddenPreviewDraft(draft.trim());
    setSelectedMatchId('');
    setCandidateOpen(false);
    flash('已发送音乐语音条，文字仍保留在输入框');
  }

  function repeatVoice(message) {
    if (!message?.trackId) return;
    const sentAt = Date.now();
    setMessages((current) => [
      ...current,
      {
        ...message,
        id: `voice-repeat-${Date.now()}`,
        side: 'me',
        time: nowTime(),
        sentAt,
      },
    ]);
    recordUsage({ id: message.trackId });
    flash('+1 已跟发同款语音');
  }

  function sendText() {
    const text = draft.trim();
    if (!text) return;
    const sentAt = Date.now();
    setMessages((current) => [
      ...current,
      { id: `text-${Date.now()}`, type: 'text', side: 'me', text, time: nowTime(), sentAt },
    ]);
    setDraft('');
    setSelectedMatchId('');
    setHiddenPreviewDraft('');
    setCandidateOpen(false);
  }

  function forwardTrack(track) {
    goScreen('chat');
    setTimeout(() => sendMusic(track), 0);
  }

  function startLongPress() {
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setLastWorldScreen('discover');
      setScreen('discover');
    }, 650);
  }

  function stopLongPress() {
    window.clearTimeout(longPressTimer.current);
  }

  function addCustomTrack(track, addToFavorites) {
    setCustomTracks((current) => [track, ...current]);
    if (addToFavorites) setFavoriteIds((current) => (current.includes(track.id) ? current : [track.id, ...current]));
    goScreen('library');
    flash('自制梗曲已保存并参与识别');
  }

  function submitPost(text, trackId) {
    const track = byId(tracks, trackId);
    setPosts((current) => [
      {
        id: `post-${Date.now()}`,
        friend: true,
        author: '我',
        time: '刚刚',
        visibility: '好友可见',
        text,
        trackId: track.id,
        likes: 0,
        type: 'original',
      },
      ...current,
    ]);
    setPublishOpen(false);
    flash('动态已发布');
  }

  return (
    <div className="mobile-stage">
      <PhoneFrame>
        {screen === 'chat' && (
          <ChatScreen
            draft={draft}
            messages={messages}
            match={match}
            candidates={candidates}
            candidateOpen={candidateOpen}
            selectedMatchId={selectedMatchId}
            favoriteSet={favoriteSet}
            playingKey={playingKey}
            onDraft={updateDraft}
            onSendText={sendText}
            onSendMusic={() => sendMusic()}
            onRepeatVoice={repeatVoice}
            onPlay={playTrack}
            onToggleFavorite={toggleFavorite}
            onOpenCandidates={() => setCandidateOpen((value) => !value)}
            onSelectCandidate={setSelectedMatchId}
            onLongPressStart={startLongPress}
            onLongPressEnd={stopLongPress}
          />
        )}
        {screen === 'entry' && <EntryScreen onWorld={goWorld} onLibrary={() => goScreen('library')} />}
        {screen === 'discover' && (
          <DiscoverScreen
            tracks={featured}
            allTracks={tracks}
            playlistTracks={playlistTracks}
            playingKey={playingKey}
            favoriteSet={favoriteSet}
            onPlay={playTrack}
            onToggleFavorite={toggleFavorite}
            onForward={forwardTrack}
            onScreen={goScreen}
            onNotice={flash}
          />
        )}
        {screen === 'square' && (
          <SquareScreen
            posts={posts}
            tracks={tracks}
            friendOnly={friendOnly}
            playingKey={playingKey}
            favoriteSet={favoriteSet}
            onFriendOnly={setFriendOnly}
            onPlay={playTrack}
            onLike={(postId) => setPosts((current) => current.map((post) => (post.id === postId ? { ...post, likes: post.likes + 1 } : post)))}
            onToggleFavorite={toggleFavorite}
            onForward={forwardTrack}
            onPublish={() => setPublishOpen(true)}
            onScreen={goScreen}
          />
        )}
        {screen === 'studio' && (
          <StudioScreen
            onSaveCustom={addCustomTrack}
            onScreen={goScreen}
          />
        )}
        {screen === 'library' && (
          <LibraryScreen
            tracks={libraryTracks}
            allTracks={tracks}
            categories={categories}
            query={query}
            activeFilter={activeFilter}
            usageByTrack={usageByTrack}
            playingKey={playingKey}
            favoriteSet={favoriteSet}
            onQuery={setQuery}
            onFilter={setActiveFilter}
            onPlay={playTrack}
            onToggleFavorite={toggleFavorite}
            onUseTrigger={(trigger) => {
              updateDraft(trigger);
              goScreen('chat');
            }}
            onSaveCustom={addCustomTrack}
            onScreen={goScreen}
          />
        )}
        {publishOpen && <PublishModal tracks={tracks} onClose={() => setPublishOpen(false)} onSubmit={submitPost} />}
        {toast && <div className="toast">{toast}</div>}
        <audio ref={audioRef} />
      </PhoneFrame>
    </div>
  );
}

function PhoneFrame({ children }) {
  return (
    <main className="phone-frame" aria-label="梗世界手机 App 原型">
      {children}
    </main>
  );
}

function StatusBar() {
  return (
    <div className="status-bar">
      <strong>15:35</strong>
      <span className="system-icons" aria-hidden="true">
        <i className="signal"><b /><b /><b /><b /></i>
        <i className="wifi" />
        <i className="battery">73</i>
      </span>
    </div>
  );
}

function AppHeader({ title, subtitle, action, onBack }) {
  return (
    <>
      <StatusBar />
      <header className="app-header">
        {onBack ? (
          <button type="button" className="icon-btn" onClick={onBack} aria-label="返回">
            <ArrowLeft size={23} weight="bold" />
          </button>
        ) : (
          <BrandOrb />
        )}
        <div>
          <strong>{title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {action || <button type="button" className="icon-btn" aria-label="更多"><DotsThree size={24} weight="bold" /></button>}
      </header>
    </>
  );
}

function BrandOrb() {
  return (
    <span className="brand-orb" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function ChatScreen({
  draft,
  messages,
  match,
  candidates,
  candidateOpen,
  selectedMatchId,
  favoriteSet,
  playingKey,
  onDraft,
  onSendText,
  onSendMusic,
  onRepeatVoice,
  onPlay,
  onToggleFavorite,
  onOpenCandidates,
  onSelectCandidate,
  onLongPressStart,
  onLongPressEnd,
}) {
  return (
    <section className="screen chat-screen">
      <StatusBar />
      <header className="wechat-nav">
        <ArrowLeft size={30} />
        <strong>45</strong>
        <DotsThree size={30} weight="bold" />
      </header>
      <div className="chat-body">
        <div className="chat-note">音乐梗能力只在文字命中时出现</div>
        {messages.map((message, index) => (
          <React.Fragment key={message.id}>
            {shouldShowMessageTime(message, messages[index - 1]) && <div className="chat-time-divider">{message.time}</div>}
            <ChatMessage
              message={message}
              playingKey={playingKey}
              favoriteSet={favoriteSet}
              onPlay={onPlay}
              onToggleFavorite={onToggleFavorite}
              onRepeatVoice={onRepeatVoice}
            />
          </React.Fragment>
        ))}
      </div>
      <div className="composer-zone">
        {match && (
          <div
            className="match-card"
            role="group"
            aria-label="音乐梗发送框，长按进入梗世界"
            onPointerDown={onLongPressStart}
            onPointerUp={onLongPressEnd}
            onPointerLeave={onLongPressEnd}
            onPointerCancel={onLongPressEnd}
          >
            {candidateOpen && (
              <div className="candidate-list">
                {candidates.slice(0, 3).map((candidate) => (
                  <button
                    type="button"
                    key={candidate.id}
                    className={candidate.id === (selectedMatchId || match.id) ? 'is-active' : ''}
                    onClick={() => onSelectCandidate(candidate.id)}
                  >
                    <span>{candidate.title}</span>
                    <small>{percent(candidate.score)} | {candidate.artist}</small>
                  </button>
                ))}
              </div>
            )}
            {candidateOpen && <div className="match-divider" />}
            <div className="match-primary">
              <button type="button" className="play-btn" onClick={() => onPlay(match, `match-${match.id}`)} aria-label="试听">
                {playingKey === `match-${match.id}` ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
              </button>
              <div>
                <strong>{match.title} | {match.artist}</strong>
                <span>触发词 {match.matchedTrigger}</span>
              </div>
              <button type="button" className="match-toggle" onClick={onOpenCandidates} aria-label={candidateOpen ? '收起候选' : '展开候选'}>
                <img src={matchToggleIcon} alt="" aria-hidden="true" />
              </button>
              <button type="button" className="send-music-btn" onClick={onSendMusic} aria-label="发送音频">
                <img src={matchSendIcon} alt="" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        <div className="wechat-input-bar">
          <button type="button" className="round-btn" aria-label="语音输入"><SpeakerHigh size={20} /></button>
          <textarea
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            placeholder="输入文字自动识别梗曲"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSendText();
              }
            }}
          />
          <button type="button" className="text-send-btn" onClick={onSendText} disabled={!draft.trim()}>
            发送
          </button>
          <button type="button" className="round-btn" aria-label="表情"><Smiley size={22} /></button>
          <button type="button" className="round-btn" aria-label="更多功能"><Plus size={22} /></button>
        </div>
      </div>
    </section>
  );
}

function ChatMessage({ message, playingKey, favoriteSet, onPlay, onToggleFavorite, onRepeatVoice }) {
  if (message.type === 'voice') {
    const track = {
      id: message.trackId,
      title: message.title,
      artist: message.artist,
      audioUrl: message.audioUrl,
      duration: message.duration,
    };
    return (
      <div className={`message-row ${message.side}`}>
        <button
          type="button"
          className="voice-strip"
          onClick={() => onPlay(track, `message-${message.id}`)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className="voice-icon">{playingKey === `message-${message.id}` ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}</span>
          <Wave active={playingKey === `message-${message.id}`} />
          <small>{message.duration || '0:03'}</small>
        </button>
        <div className="voice-meta">
          <span>{message.title} · {message.artist}</span>
          <button type="button" className="repeat-btn" onClick={() => onRepeatVoice(message)}>+1</button>
          <button type="button" onClick={() => onToggleFavorite(track)}>{favoriteSet.has(message.trackId) ? '已收藏' : '收藏'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`message-row ${message.side}`}>
      {message.side === 'friend' && <span className="avatar">对</span>}
      <div className="text-bubble">
        <p>{message.text}</p>
      </div>
    </div>
  );
}

function EntryScreen({ onWorld, onLibrary }) {
  return (
    <section className="screen entry-screen">
      <StatusBar />
      <img className="entry-bg" src="/geng-world-main.jpg" alt="梗世界入口视觉" />
      <button type="button" className="entry-action entry-world" onClick={onWorld} aria-label="进入梗世界" />
      <button type="button" className="entry-action entry-library" onClick={onLibrary} aria-label="进入梗库" />
      <button type="button" className="emotion-entry" onClick={onWorld} aria-label="打开情绪推荐夹" />
    </section>
  );
}





const FIGMA622 = '/figma-622/';
const FIGMA_RETURN_TOP_KEY = 'geng-world.return-top-v2';

function trackById(tracks, id) {
  return id ? tracks.find((track) => track.id === id) || null : null;
}

function resolveDisplayTrack(tracks, item, fallback = null) {
  const source = Array.isArray(tracks) ? tracks : [];
  const exact = trackById(source, item.trackId);
  const matched = exact || findTrackMatches(item.matchText || item.trigger || item.title || '', source)[0] || fallback;
  if (!matched) return null;
  const [songTitle, artist] = (item.song || item.title || '').split('|').map((part) => part.trim());
  return {
    ...matched,
    title: item.songTitle || songTitle || matched.title,
    artist: item.artist || artist || matched.artist,
    matchedTrigger: item.trigger || matched.matchedTrigger || matched.triggers?.[0],
    triggers: item.trigger ? [item.trigger, ...(matched.triggers || [])] : matched.triggers,
  };
}

function FigmaAsset({ name, className = '', alt = '' }) {
  return <img className={`fg-asset ${className}`} src={`${FIGMA622}${name}`} alt={alt} draggable="false" />;
}

function FigmaPlay({ track, playKey, playingKey, onPlay, onMissing, className = '' }) {
  const isPlaying = track && playingKey === playKey;
  return (
    <button
      type="button"
      className={`fg-play ${className}`}
      disabled={!track && !onMissing}
      onClick={(event) => {
        event.stopPropagation();
        if (track) onPlay(track, playKey);
        else onMissing?.();
      }}
      aria-label={!track ? '音频缺失' : isPlaying ? '暂停' : '播放'}
    >
      {isPlaying ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
    </button>
  );
}

function FigmaHeart({ track, favoriteSet, onToggleFavorite, onMissing, className = '' }) {
  const saved = track && favoriteSet.has(track.id);
  return (
    <button
      type="button"
      className={`fg-heart ${saved ? 'is-saved' : ''} ${className}`}
      disabled={!track && !onMissing}
      onClick={(event) => {
        event.stopPropagation();
        if (track) onToggleFavorite(track);
        else onMissing?.();
      }}
      aria-label={!track ? '歌曲缺失' : saved ? '取消收藏' : '收藏'}
    >
      <Heart size={27} weight={saved ? 'fill' : 'regular'} />
    </button>
  );
}

function FigmaTag({ children, tone = 'green', className = '' }) {
  return <span className={`fg-tag ${tone} ${className}`}>{children}</span>;
}

function FigmaReturn({ onScreen }) {
  const [top, setTop] = useState(() => {
    if (typeof window === 'undefined') return 598;
    const raw = window.localStorage.getItem(FIGMA_RETURN_TOP_KEY);
    const saved = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(saved) ? Math.min(780, Math.max(70, saved)) : 598;
  });
  const dragRef = useRef({ timer: 0, dragging: false, startY: 0, startTop: 0 });

  function clampTop(value) {
    return Math.min(780, Math.max(70, value));
  }

  function clearTimer() {
    window.clearTimeout(dragRef.current.timer);
    dragRef.current.timer = 0;
  }

  function onPointerDown(event) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      timer: window.setTimeout(() => {
        dragRef.current.dragging = true;
      }, 280),
      dragging: false,
      startY: event.clientY,
      startTop: top,
    };
  }

  function onPointerMove(event) {
    if (!dragRef.current.dragging) return;
    const nextTop = clampTop(dragRef.current.startTop + event.clientY - dragRef.current.startY);
    setTop(nextTop);
    window.localStorage.setItem(FIGMA_RETURN_TOP_KEY, String(nextTop));
  }

  function onPointerUp(event) {
    clearTimer();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (dragRef.current.dragging) {
      dragRef.current.dragging = false;
      return;
    }
    onScreen('chat');
  }

  return (
    <button
      type="button"
      className="fg-return"
      style={{ top }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={clearTimer}
      aria-label="返回聊天"
    >
      <ArrowLeft size={28} weight="bold" />
    </button>
  );
}

function FigmaBottomNav({ active, onScreen }) {
  return (
    <nav className="fg-bottom" aria-label="底部导航">
      <FigmaAsset name="grass.png" className="fg-bottom-grass" />
      <button type="button" className={`fg-nav fg-nav-world ${active === 'world' ? 'is-active' : ''}`} onClick={() => onScreen('discover')} aria-label="梗世界">
        <FigmaAsset name={active === 'world' ? 'earth.png' : 'earth-gray.png'} />
      </button>
      <button type="button" className={`fg-nav fg-nav-studio ${active === 'studio' ? 'is-active' : ''}`} onClick={() => onScreen('studio')} aria-label="制梗间">
        <FigmaAsset name="studio.png" />
      </button>
      <button type="button" className={`fg-nav fg-nav-library ${active === 'library' ? 'is-active' : ''}`} onClick={() => onScreen('library')} aria-label="梗库">
        <FigmaAsset name="folder-clean.png" />
      </button>
    </nav>
  );
}

function WorldRecCard({ item, track, index, playingKey, favoriteSet, onPlay, onToggleFavorite, onMissing }) {
  return (
    <article className="fg-rec-card">
      <div className="fg-rec-cover">
        <img src={`${FIGMA622}${item.cover}`} alt={item.title} />
        <FigmaPlay track={track} playKey={`fg-rec-${track?.id || index}`} playingKey={playingKey} onPlay={onPlay} onMissing={onMissing} className="fg-rec-play" />
      </div>
      <div className="fg-rec-title">{item.title}</div>
      <FigmaTag tone={item.tone} className="fg-rec-tag">{item.tag}</FigmaTag>
      <FigmaHeart track={track} favoriteSet={favoriteSet} onToggleFavorite={onToggleFavorite} onMissing={onMissing} className="fg-rec-heart" />
    </article>
  );
}

function FigmaRankPanel({ className, title, items, tracks, playingKey, favoriteSet, onPlay, onToggleFavorite, onMissing }) {
  return (
    <article className={`fg-rank-panel ${className}`}>
      <h3>{title}</h3>
      {items.map((item, index) => {
        const track = resolveDisplayTrack(tracks, item);
        return (
          <div className="fg-rank-row" key={item.label}>
            <div>
              <strong>{index + 1} {item.label}</strong>
              <span>{item.meta}</span>
            </div>
            <FigmaPlay track={track} playKey={`fg-rank-${track?.id || item.label}`} playingKey={playingKey} onPlay={onPlay} onMissing={onMissing} />
            <FigmaHeart track={track} favoriteSet={favoriteSet} onToggleFavorite={onToggleFavorite} onMissing={onMissing} />
          </div>
        );
      })}
    </article>
  );
}

function FigmaFeedCard({ className = '', avatar, author, status, time = '3小时前 | 公开可见', text, cover, title, tag, artist, track, likes, shares, comments, playingKey, favoriteSet, onPlay, onToggleFavorite, onForward, onNotice = () => {} }) {
  const [followed, setFollowed] = useState(() => status !== '未关注');
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(() => Number(likes) || 0);
  const [shareCount, setShareCount] = useState(() => Number(shares) || 0);
  const [commentCount, setCommentCount] = useState(() => Number(comments) || 0);
  const feedPlayKey = `fg-feed-${track?.id || title}`;
  const sourceText = artist || track?.artist || '原创作者';
  const missingText = '这首歌还没有音频文件，补入后就能播放';

  function playFeedTrack() {
    if (track) onPlay(track, feedPlayKey);
    else onNotice(missingText);
  }

  function onTrackKeyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    playFeedTrack();
  }

  return (
    <article className={`fg-feed ${className}`}>
      <header>
        <img src={`${FIGMA622}${avatar}`} alt={author} />
        <div>
          <strong>{author}</strong>
          <span>{time}</span>
        </div>
        <button
          type="button"
          className={`fg-follow ${followed ? 'is-followed' : ''}`}
          onClick={() => {
            setFollowed((value) => !value);
            onNotice(followed ? '已取消关注' : '已关注');
          }}
        >
          {followed ? '已关注' : '未关注'}
        </button>
      </header>
      <p>{text}</p>
      <div
        className={`fg-feed-track ${track ? '' : 'is-missing'}`}
        role="button"
        tabIndex={0}
        title={`${title} | 原唱：${sourceText}`}
        onClick={playFeedTrack}
        onKeyDown={onTrackKeyDown}
      >
        <img src={`${FIGMA622}${cover}`} alt={title} />
        <FigmaPlay track={track} playKey={feedPlayKey} playingKey={playingKey} onPlay={onPlay} onMissing={() => onNotice(missingText)} className="fg-feed-play" />
        <div className="fg-feed-track-copy">
          <strong>{title}</strong>
          <div className="fg-feed-track-meta">
            <FigmaTag tone={tag === 'KPOP' ? 'green' : 'gray'}>{tag}</FigmaTag>
            <span>原唱：{sourceText}</span>
          </div>
        </div>
        <FigmaHeart track={track} favoriteSet={favoriteSet} onToggleFavorite={onToggleFavorite} onMissing={() => onNotice(missingText)} />
      </div>
      <footer>
        <button
          type="button"
          className={liked ? 'is-active' : ''}
          onClick={() => {
            const nextLiked = !liked;
            setLiked(nextLiked);
            setLikeCount((count) => count + (nextLiked ? 1 : -1));
            onNotice(nextLiked ? '已点赞' : '已取消点赞');
          }}
        >
          <Heart size={23} weight={liked ? 'fill' : 'regular'} />{likeCount}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!track) {
              onNotice(missingText);
              return;
            }
            setShareCount((count) => count + 1);
            onForward(track);
          }}
        >
          <ShareFat size={23} />{shareCount}
        </button>
        <button
          type="button"
          onClick={() => {
            setCommentCount((count) => count + 1);
            onNotice('已记录一次评论互动');
          }}
        >
          <ChatCircleDots size={23} />{commentCount}
        </button>
      </footer>
    </article>
  );
}

function DiscoverScreen({ tracks, allTracks = tracks, playlistTracks, playingKey, favoriteSet, onPlay, onToggleFavorite, onForward, onScreen, onNotice }) {
  const sourceTracks = allTracks.length ? allTracks : tracks;
  const recommendations = [
    { title: 'Watch me go go', tag: 'KPOP', tone: 'green', cover: 'cover-watch.png', matchText: 'go' },
    { title: '一天一天贴近你的心', tag: '综艺', tone: 'yellow', cover: 'cover-dayday.png' },
    { title: '新疆葡萄大', tag: 'KPOP', tone: 'green', cover: 'cover-wego.png', trackId: 'xinjiang-putao-da-we-go-up-nct-dream' },
    { title: '第一次去卢浮宫', tag: '二次元', tone: 'pink', cover: 'cover-anime.png' },
    { title: '哈吉米', tag: '二次元', tone: 'pink', cover: 'cover-horse.png' },
  ];
  const packItems = [
    { label: '超级英雄', trackId: 'gogogo', trigger: 'gogogo/出发喽', song: '超级英雄 | 邓超' },
    { label: '野狼disco', trigger: '野狼disco' },
    { label: '无敌', trackId: 'track-piohbm', trigger: '无敌/是多么寂寞', song: '无敌 | 邓超' },
  ];
  const hotItems = [
    { label: 'SORRY, SORRY', trackId: 'sorry-sorry-sorry-sorry-super-junior', trigger: 'sorry', song: 'SORRY, SORRY | SUPER JUNIOR', meta: '上榜3周|上周排名2' },
    { label: '超级英雄', trackId: 'gogogo', trigger: 'gogogo/出发喽', song: '超级英雄 | 邓超', meta: '上榜3周|上周排名1' },
    { label: '心愿便利贴', trigger: '心愿便利贴', meta: '新上榜|上周排名-' },
  ];
  const homemadeItems = [
    { label: '那艺娜Heya', trackId: 'heya-ive', trigger: '嗨呀', song: 'HEYA | IVE', meta: '上榜1周|上周排名9' },
    { label: '崔机主版ggum', trackId: 'gangqiu-gang-ggum-yeonjun', trigger: '钢球刚', song: 'GGUM | 崔然竣', meta: '上榜4周|上周排名4' },
    { label: '桃黑黑西安', trigger: '桃黑黑西安', meta: '上榜5周|上周排名9' },
  ];
  const feedOne = resolveDisplayTrack(sourceTracks, { trackId: 'track-1gbm8h4', song: '桃黑黑西安 | 自制', trigger: '桃黑黑西安' });
  const feedTwo = resolveDisplayTrack(sourceTracks, { trackId: 'rude-rude-hearts2hearts', song: 'RUDE! | Hearts2Hearts', trigger: 'rude' });
  const packTracks = packItems.map((item) => resolveDisplayTrack(sourceTracks, item)).filter(Boolean);

  return (
    <section className="screen fg-screen fg-world-screen">
      <div className="fg-scroll fg-world-scroll">
        <div className="fg-page">
          <div className="fg-search"><span>猜你想搜</span></div>
          <FigmaAsset name="search.png" className="fg-search-icon" />

          <h1 className="fg-title fg-like-title">猜你喜欢</h1>
          <FigmaAsset name="heart.png" className="fg-title-heart" />
          <div className="fg-rec-strip">
            <div className="fg-rec-track">
              {recommendations.map((item, index) => (
                <WorldRecCard
                  key={item.title}
                  item={item}
                  index={index}
                  track={resolveDisplayTrack(sourceTracks, item)}
                  playingKey={playingKey}
                  favoriteSet={favoriteSet}
                  onPlay={onPlay}
                  onToggleFavorite={onToggleFavorite}
                  onMissing={() => onNotice?.('这首歌还没有音频文件，补入后就能播放')}
                />
              ))}
            </div>
          </div>

          <h2 className="fg-title fg-pack-title">精选梗包</h2>
          <FigmaAsset name="bag.png" className="fg-pack-bag" />
          <div className="fg-pack-strip">
            <div className="fg-pack-track">
              <article className="fg-pack-card fg-pack-yellow">
                <div className="fg-pack-copy">
                  <h3>五哈爆笑合集</h3>
                  <p>共6首 <FigmaTag tone="yellow">综艺</FigmaTag> <FigmaTag tone="yellow">华语</FigmaTag></p>
                  {packItems.map((item, index) => {
                    const track = resolveDisplayTrack(sourceTracks, item);
                    return (
                      <div className="fg-pack-row" key={item.label}>
                        <span>{index + 1} {item.label}</span>
                        <FigmaPlay track={track} playKey={`fg-pack-${track?.id || item.label}`} playingKey={playingKey} onPlay={onPlay} onMissing={() => onNotice?.('这首歌还没有音频文件，补入后就能播放')} />
                        <FigmaHeart track={track} favoriteSet={favoriteSet} onToggleFavorite={onToggleFavorite} onMissing={() => onNotice?.('这首歌还没有音频文件，补入后就能播放')} />
                      </div>
                    );
                  })}
                </div>
                <img src={`${FIGMA622}cover-pack.png`} alt="五哈爆笑合集" />
                <button
                  type="button"
                  className="fg-pack-plus"
                  onClick={() => {
                    const nextTracks = packTracks.filter((track) => !favoriteSet.has(track.id));
                    if (!nextTracks.length) {
                      onNotice?.('这套曲库已在梗库里');
                      return;
                    }
                    nextTracks.forEach((track) => onToggleFavorite(track));
                  }}
                  aria-label="收藏整套曲库"
                >
                  <Plus size={38} weight="bold" />
                </button>
              </article>
              <article className="fg-pack-card fg-pack-mint">
                <h3>IT’s 克拉time!</h3>
                <p>共18首 <FigmaTag tone="green">KPOP</FigmaTag></p>
                <ol>
                  <li>VERY NICE</li>
                  <li>HOT</li>
                  <li>THUNDER</li>
                </ol>
              </article>
            </div>
          </div>

          <h2 className="fg-title fg-hot-title">最多人用</h2>
          <FigmaAsset name="fire.png" className="fg-fire" />
          <FigmaRankPanel
            className="fg-rank-left"
            title="本周最火音梗"
            items={hotItems}
            tracks={sourceTracks}
            playingKey={playingKey}
            favoriteSet={favoriteSet}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
            onMissing={() => onNotice?.('这首歌还没有音频文件，补入后就能播放')}
          />
          <FigmaRankPanel
            className="fg-rank-right"
            title="自制最火音梗"
            items={homemadeItems}
            tracks={sourceTracks}
            playingKey={playingKey}
            favoriteSet={favoriteSet}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
            onMissing={() => onNotice?.('这首歌还没有音频文件，补入后就能播放')}
          />

          <h2 className="fg-title fg-square-title">梗广场</h2>
          <FigmaAsset name="bulb.png" className="fg-bulb" />
          <FigmaFeedCard
            className="fg-feed-one"
            avatar="avatar-emperor.png"
            author="皇帝你儿子是"
            status="已关注"
            text="开机。有一座城市他让人难以割舍♫ 都来用这个桃黑黑的西安人之歌好吗?"
            cover="cover-feed.png"
            title="桃黑黑西安"
            tag="自制"
            artist="皇帝你儿子是"
            track={feedOne}
            likes="2333"
            shares="125"
            comments="34"
            playingKey={playingKey}
            favoriteSet={favoriteSet}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
            onForward={onForward}
            onNotice={onNotice}
          />
          <FigmaFeedCard
            className="fg-feed-two"
            avatar="avatar-girl.png"
            author="不想上早八"
            status="未关注"
            time="9小时前 | 公开可见"
            text="You know what him said to me? He was like 你迟到了。。。"
            cover="cover-rude.png"
            title="RUDE!"
            tag="KPOP"
            artist="Hearts2Hearts"
            track={feedTwo}
            likes="1024"
            shares="88"
            comments="19"
            playingKey={playingKey}
            favoriteSet={favoriteSet}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
            onForward={onForward}
            onNotice={onNotice}
          />
        </div>
      </div>
      <FigmaReturn onScreen={onScreen} />
      <FigmaBottomNav active="world" onScreen={onScreen} />
    </section>
  );
}


function SongCard({ track, index, playingKey, favoriteSet, onPlay, onToggleFavorite, onForward }) {
  return (
    <article className="song-card">
      <div className={`cover cover-${index % 3}`}>{track.title.slice(0, 4)}</div>
      <h3>{track.title} · {track.artist}</h3>
      <p>适合聊天接梗、情绪回应和朋友局转发。</p>
      <div className="card-actions">
        <button type="button" onClick={() => onPlay(track, `song-${track.id}`)}>
          {playingKey === `song-${track.id}` ? '暂停' : '3 秒试听'}
        </button>
        <button type="button" className="dark" onClick={() => onToggleFavorite(track)}>
          {favoriteSet.has(track.id) ? '已加入' : '加入我的梗库'}
        </button>
      </div>
      <button type="button" className="forward-mini" onClick={() => onForward(track)}>转发聊天</button>
    </article>
  );
}





function SquareScreen({ tracks, playingKey, favoriteSet, onPlay, onToggleFavorite, onForward, onScreen }) {
  return (
    <DiscoverScreen
      tracks={tracks.slice(0, 6)}
      allTracks={tracks}
      playlistTracks={tracks.slice(6, 10)}
      playingKey={playingKey}
      favoriteSet={favoriteSet}
      onPlay={onPlay}
      onToggleFavorite={onToggleFavorite}
      onForward={onForward}
      onScreen={onScreen}
    />
  );
}

function LibraryScreen({ tracks, allTracks = [], query, activeFilter, usageByTrack, playingKey, favoriteSet, onQuery, onFilter, onPlay, onToggleFavorite, onUseTrigger, onScreen }) {
  const sourceTracks = allTracks.length ? allTracks : tracks;
  const displayRows = [
    { title: 'HOT | SEVENTEEN', trigger: '雾都雾里七个八', trackId: 'we-go-up-nct-dream' },
    { title: '超级英雄 | 邓超', trigger: 'gogogo/出发喽', trackId: 'gogogo' },
    { title: '无敌 | 邓超', trigger: '无敌/是多么寂寞', trackId: 'track-piohbm' },
    { title: 'RUDE! | Hearts2Hearts', trigger: "don't care/you know what", trackId: 'don-t-care-rude-hearts2hearts' },
    { title: 'SORRY, SORRY | SUPER JUNIOR', trigger: 'sorry/对不起', trackId: 'sorry-sorry-sorry-sorry-super-junior' },
    { title: 'GO! | CORTIS', trigger: 'go', trackId: 'go-go-cortis' },
    { title: 'Telephone | Lady Gaga/Beyoncé', trigger: 'busy', trackId: 'busy-telephone-lady-gaga-beyonce' },
    { title: 'Hello | Adele', trigger: "Hello/it's me", trackId: 'hello-it-s-me-hello-adele' },
    { title: '命运交响曲 | 贝多芬', trigger: '悲惨/崩溃', trackId: 'track-1gbm8h4' },
  ];
  const queryText = query.trim().toLowerCase();
  const matchesQuery = (text) => {
    if (!queryText) return true;
    const normalized = text.toLowerCase().normalize('NFKC');
    if (/^[a-z0-9]+$/i.test(queryText)) {
      return normalized
        .split(/[^a-z0-9]+/i)
        .filter(Boolean)
        .some((token) => token === queryText || token.startsWith(queryText));
    }
    return normalized.includes(queryText);
  };
  const displayIds = new Set(displayRows.map((row) => row.trackId).filter(Boolean));
  const dynamicRows = queryText
    ? sourceTracks
      .filter((track) => !displayIds.has(track.id))
      .map((track) => ({
        title: `${track.title} | ${track.artist}`,
        trigger: track.triggers?.slice(0, 2).join('/') || '',
        trackId: track.id,
      }))
    : [];
  const rowSource = [...displayRows, ...dynamicRows];
  const filteredRows = rowSource.filter((item) => {
    const track = resolveDisplayTrack(sourceTracks, item);
    const searchable = `${item.title} ${item.trigger} ${track?.title || ''} ${track?.artist || ''} ${track?.genre || ''} ${track?.triggers?.join(' ') || ''}`.toLowerCase();
    const matchQuery = matchesQuery(searchable);
    const matchCategory = activeFilter === '全部' || track?.categories?.includes(activeFilter) || track?.category === activeFilter;
    return matchQuery && matchCategory;
  });
  const visibleRows = filteredRows.slice(0, 12);
  const rankedRows = [
    { title: 'HOT', count: 23 },
    { title: '超级英雄', count: 16 },
    { title: '无敌', count: 9 },
  ];
  const tabs = [
    { label: '我的梗包', filter: '全部', asset: 'bag.png', icon: 'bag' },
    { label: 'KPOP乱炖', filter: 'Kpop', asset: 'heart.png', icon: 'heart' },
    { label: '五哈爆笑合集', filter: '综艺', asset: 'fish.png', icon: 'fish' },
    { label: '上班哪有不疯的', filter: '华语', asset: 'star.png', icon: 'star' },
  ];

  return (
    <section className="screen fg-screen fg-library-screen">
      <div className="fg-scroll fg-library-scroll">
        <div className="fg-page fg-library-page">
          <section className="fg-profile">
            <img className="fg-profile-avatar" src={`${FIGMA622}avatar-profile.jpg`} alt="AAA北美曲库" />
            <article className="fg-profile-card">
              <h1>AAA北美曲库</h1>
              <p>本周常使用</p>
              <ol>
                {rankedRows.map(({ title, count }, index) => (
                  <li key={title}>
                    <span>{index + 1} {title}</span>
                    <strong>{count}次</strong>
                  </li>
                ))}
              </ol>
              <FigmaAsset name="knot.png" className="fg-profile-knot" />
            </article>
          </section>

          <label className="fg-lib-search">
            <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="IVE" />
          </label>
          <FigmaAsset name="search.png" className="fg-lib-search-icon" />

          <div className="fg-lib-tabs">
            <div className="fg-lib-tab-track">
              {tabs.map((tab) => (
                <button
                  type="button"
                  key={tab.label}
                  className={`fg-lib-tab ${activeFilter === tab.filter || (!activeFilter && tab.filter === '全部') ? 'is-active' : ''}`}
                  onClick={() => onFilter(tab.filter)}
                >
                  <FigmaAsset name={tab.asset} className={`fg-tab-icon fg-tab-${tab.icon}`} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          <section className="fg-library-list">
            {visibleRows.map((item, index) => {
              const track = resolveDisplayTrack(sourceTracks, item);
              const fillText = item.trigger.split('/')[0];
              return (
                <article className="fg-library-row" key={item.title}>
                  <strong className="fg-library-index">{index + 1}</strong>
                  <div className="fg-library-copy">
                    <h3>{item.title}</h3>
                    <p>触发词： {item.trigger}</p>
                  </div>
                  <button type="button" className="fg-library-fill" onClick={() => onUseTrigger(fillText)}>填入</button>
                  <FigmaPlay track={track} playKey={`fg-library-${track?.id || index}`} playingKey={playingKey} onPlay={onPlay} />
                  <button type="button" className="fg-library-more" aria-label="更多"><DotsThree size={27} weight="bold" /></button>
                </article>
              );
            })}
            {!visibleRows.length && <div className="fg-library-empty">没有找到匹配的音梗</div>}
          </section>
        </div>
      </div>
      <FigmaReturn onScreen={onScreen} />
      <FigmaBottomNav active="library" onScreen={onScreen} />
    </section>
  );
}

function StudioScreen({ onSaveCustom, onScreen }) {
  return (
    <section className="screen fg-screen fg-studio-screen">
      <div className="fg-scroll fg-studio-scroll">
        <div className="fg-page fg-studio-page">
          <UploadComposer onSaveCustom={onSaveCustom} />
        </div>
      </div>
      <FigmaReturn onScreen={onScreen} />
      <FigmaBottomNav active="studio" onScreen={onScreen} />
    </section>
  );
}


const MAX_MEME_SECONDS = 15;
const MIN_SELECTION_SECONDS = 0.05;

const clarityOptions = [
  { id: 'standard', label: '标准音频', detail: '模糊档，人声可读，体积小', rate: 22050 },
  { id: 'balanced', label: '均衡通用', detail: '推荐档，音质和体积平衡', rate: 44100 },
  { id: 'clear', label: '高清无损', detail: '清晰档，细节更完整', rate: 48000 },
];

const denoiseOptions = [
  { id: 'light', label: '轻度' },
  { id: 'medium', label: '中度' },
  { id: 'strong', label: '强力' },
];

const environmentOptions = [
  { id: 'raw', label: '原声' },
  { id: 'hall', label: '大厅回声' },
  { id: 'valley', label: '空谷回声' },
  { id: 'speaker', label: '扩音器' },
  { id: 'muffled', label: '闷音密闭' },
  { id: 'bathroom', label: '浴室回音' },
];

const voiceOptions = [
  { id: 'native', label: '原生本音' },
  { id: 'robot', label: '机械机器人' },
  { id: 'opera', label: '美声浑厚' },
  { id: 'sweet', label: '清甜少女音' },
  { id: 'uncle', label: '低沉大叔音' },
  { id: 'cartoon', label: '卡通童声' },
];

const exportTargetOptions = [
  { id: 'complete', label: '完整成品' },
  { id: 'selection', label: '选中片段' },
];

const audioEngineBaseUrl = '';

function clarityFromSampleRate(rate = 44100) {
  if (rate <= 22050) return 'standard';
  if (rate >= 48000) return 'clear';
  return 'balanced';
}

function dbToGain(value) {
  return Math.pow(10, Number(value) / 20);
}

function UploadComposer({ onSaveCustom }) {
  const [file, setFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [segments, setSegments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [undoStack, setUndoStack] = useState([]);
  const [outputBuffer, setOutputBuffer] = useState(null);
  const [outputBlob, setOutputBlob] = useState(null);
  const [outputUrl, setOutputUrl] = useState('');
  const [volumeDb, setVolumeDb] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [semitones, setSemitones] = useState(0);
  const [denoise, setDenoise] = useState(false);
  const [denoiseLevel, setDenoiseLevel] = useState('light');
  const [clarity, setClarity] = useState('balanced');
  const [exportFormat, setExportFormat] = useState('mp3');
  const [exportTarget, setExportTarget] = useState('complete');
  const [environmentEffect, setEnvironmentEffect] = useState('raw');
  const [voiceEffect, setVoiceEffect] = useState('native');
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState('');
  const [previewState, setPreviewState] = useState('idle');
  const [commitState, setCommitState] = useState('idle');
  const [engineStatus, setEngineStatus] = useState({ state: 'checking', mode: 'unknown' });
  const [saveToFavorites, setSaveToFavorites] = useState(true);
  const editorAudioRef = useRef(null);
  const previewRunRef = useRef(0);
  const timelineRef = useRef(null);
  const undoGestureRef = useRef('');
  const [fields, setFields] = useState({
    title: '无语停顿',
    artist: '自制音效',
    trigger: '无语',
    genre: '自选',
  });

  function updateField(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function resetRender() {
    previewRunRef.current += 1;
    setOutputBuffer(null);
    setOutputBlob(null);
    setOutputUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
    setPreviewState(audioBuffer ? 'waiting' : 'idle');
  }

  function editorSnapshot() {
    return {
      segments: segments.map((segment) => ({ ...segment })),
      selectedId,
      volumeDb,
      fadeIn,
      fadeOut,
      speed,
      semitones,
      denoise,
      denoiseLevel,
      clarity,
      environmentEffect,
      voiceEffect,
    };
  }

  function pushUndoSnapshot() {
    if (!audioBuffer || !segments.length) return;
    const snapshot = editorSnapshot();
    setUndoStack((current) => {
      const last = current[current.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return current;
      return [...current.slice(-14), snapshot];
    });
  }

  function beginUndoStep(key) {
    if (undoGestureRef.current === key) return;
    undoGestureRef.current = key;
    pushUndoSnapshot();
  }

  function endUndoStep(key) {
    if (!key || undoGestureRef.current === key) undoGestureRef.current = '';
  }

  function restoreSnapshot(snapshot) {
    const audio = editorAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setSegments(snapshot.segments.map((segment) => ({ ...segment })));
    setSelectedId(snapshot.selectedId);
    setVolumeDb(snapshot.volumeDb);
    setFadeIn(snapshot.fadeIn);
    setFadeOut(snapshot.fadeOut);
    setSpeed(snapshot.speed);
    setSemitones(snapshot.semitones);
    setDenoise(snapshot.denoise);
    setDenoiseLevel(snapshot.denoiseLevel);
    setClarity(snapshot.clarity);
    setEnvironmentEffect(snapshot.environmentEffect);
    setVoiceEffect(snapshot.voiceEffect);
    setPlayhead(0);
    setIsPlaying(false);
    resetRender();
  }

  function undoEdit() {
    const snapshot = undoStack[undoStack.length - 1];
    if (!snapshot) {
      setStatus('暂无可撤回操作');
      return;
    }
    restoreSnapshot(snapshot);
    setUndoStack((current) => current.slice(0, -1));
    setStatus('已撤回上一步');
  }

  function updateWithUndo(key, setter, value) {
    beginUndoStep(key);
    setter(value);
    resetRender();
  }

  function formatSize(value) {
    if (!value) return '0 KB';
    if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  const selectedSegment = segments.find((segment) => segment.id === selectedId) || segments[0];
  const selectedDuration = selectedSegment ? Math.max(0, selectedSegment.end - selectedSegment.start) : 0;
  const segmentDuration = segments.reduce((total, segment) => total + Math.max(0, segment.end - segment.start), 0);
  const selectedIndex = selectedSegment ? segments.findIndex((segment) => segment.id === selectedSegment.id) : -1;
  const clipRangeLabel = selectedSegment
    ? `${formatSeconds(selectedSegment.start)} - ${formatSeconds(selectedSegment.end)}，共 ${formatSeconds(selectedDuration)}`
    : '导入音频后选择片段';
  const selectedClarity = clarityOptions.find((item) => item.id === clarity) || clarityOptions[1];
  const isOverLimit = segmentDuration > MAX_MEME_SECONDS;
  const overLimitText = `成品 ${formatSeconds(segmentDuration)}，已超过 0:15，请先裁剪。`;
  const playableBuffer = outputBuffer || audioBuffer;
  const playableUrl = outputUrl || sourceUrl;
  const previewDuration = playableBuffer?.duration || metadata?.duration || 0;
  const sourceDuration = audioBuffer?.duration || 0;
  const timelineMax = Math.max(0.1, sourceDuration);
  const selectedStart = selectedSegment?.start ?? 0;
  const selectedEnd = selectedSegment?.end ?? 0;
  const selectionLeftPercent = `${sourceDuration ? (selectedStart / sourceDuration) * 100 : 0}%`;
  const selectionWidthPercent = `${sourceDuration ? (selectedDuration / sourceDuration) * 100 : 0}%`;
  const previewTitle = outputUrl ? '处理后预听' : '原音频预听';
  const previewMessage = outputUrl
    ? '正在播放已应用裁剪和音效的版本'
    : previewState === 'rendering'
      ? '正在生成处理后预听，完成后会自动切换'
      : audioBuffer
        ? '调整后会自动生成处理后版本'
        : '导入音频后可试听';
  const waveform = useMemo(() => waveformSummary(playableBuffer, 72), [playableBuffer]);
  const spectrum = useMemo(() => spectrumSummary(playableBuffer, 20), [playableBuffer]);
  const sourceWaveform = useMemo(() => waveformSummary(audioBuffer, 96), [audioBuffer]);
  const playheadRatio = previewDuration ? Math.max(0, Math.min(1, playhead / previewDuration)) : 0;
  const playheadPercent = `${playheadRatio * 100}%`;
  const rawPlayhead = segmentDuration * playheadRatio;
  let timelineSourceTime = selectedStart;
  let remainingPlayhead = rawPlayhead;
  for (const segment of segments) {
    const duration = Math.max(0, segment.end - segment.start);
    if (remainingPlayhead <= duration) {
      timelineSourceTime = segment.start + remainingPlayhead;
      break;
    }
    remainingPlayhead -= duration;
    timelineSourceTime = segment.end;
  }
  const timelinePlayheadPercent = `${sourceDuration ? Math.max(0, Math.min(1, timelineSourceTime / sourceDuration)) * 100 : 0}%`;

  useEffect(() => {
    let active = true;
    fetch(`${audioEngineBaseUrl}/api/audio/health`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('offline'))))
      .then((data) => {
        if (!active) return;
        setEngineStatus({ state: data.ok ? 'ready' : 'offline', mode: data.mode });
      })
      .catch(() => {
        if (active) setEngineStatus({ state: 'offline', mode: 'browser-only' });
      });
    return () => {
      active = false;
    };
  }, []);

  async function chooseFile(event) {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    try {
      setStatus('正在读取并解析音频');
      const decoded = await decodeAudioFile(nextFile);
      const nextSegments = initialSegments(decoded.buffer);
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      setFile(nextFile);
      setSourceUrl(URL.createObjectURL(nextFile));
      setAudioBuffer(decoded.buffer);
      setMetadata(inspectAudioFile(nextFile, decoded.buffer, decoded.sourceBuffer));
      setClarity(clarityFromSampleRate(decoded.buffer.sampleRate));
      setSegments(nextSegments);
      setSelectedId(nextSegments[0].id);
      setUndoStack([]);
      undoGestureRef.current = '';
      setPlayhead(0);
      resetRender();
      setPreviewState('waiting');
      const base = nextFile.name.replace(/\.[^.]+$/, '');
      setFields((current) => ({ ...current, title: base || current.title, trigger: current.trigger || base }));
      setStatus('音频已载入：调整参数后会自动生成处理后预听');
    } catch (error) {
      setStatus(error.message || '音频读取失败，请换一个 wav/mp3 文件');
    }
  }

  function updateSelected(patch) {
    if (!selectedSegment || !audioBuffer) return;
    setSegments((current) => current.map((segment) => {
      if (segment.id !== selectedSegment.id) return segment;
      const next = { ...segment, ...patch };
      const start = Math.max(0, Math.min(Number(next.start) || 0, audioBuffer.duration));
      const end = Math.max(start + MIN_SELECTION_SECONDS, Math.min(Number(next.end) || start + MIN_SELECTION_SECONDS, audioBuffer.duration));
      const gain = Number(next.gain);
      return {
        ...next,
        start,
        end,
        gain: Number.isFinite(gain) ? Math.max(0, Math.min(2, gain)) : 1,
      };
    }));
    resetRender();
  }

  function updateTrimStart(value) {
    if (!selectedSegment || !audioBuffer) return;
    beginUndoStep('trim-start');
    const start = Math.max(0, Math.min(Number(value), selectedSegment.end - MIN_SELECTION_SECONDS));
    updateSelected({ start });
  }

  function updateTrimEnd(value) {
    if (!selectedSegment || !audioBuffer) return;
    beginUndoStep('trim-end');
    const end = Math.min(sourceDuration, Math.max(Number(value), selectedSegment.start + MIN_SELECTION_SECONDS));
    updateSelected({ end });
  }

  function clearPreview() {
    previewRunRef.current += 1;
    setOutputBuffer(null);
    setOutputBlob(null);
    setOutputUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
    setPlayhead(0);
    setPreviewState(audioBuffer ? 'waiting' : 'idle');
  }

  async function previewCommittedSegments(nextSegments, fallbackStatus) {
    setCommitState('rendering');
    try {
      clearPreview();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      const rendered = await renderOutput(nextSegments, { skipLengthGuard: true });
      if (!rendered) {
        setStatus(fallbackStatus);
        return;
      }
      const overLimit = nextSegments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) > MAX_MEME_SECONDS;
      setStatus(overLimit
        ? `已更新预听：${formatSeconds(rendered.buffer.duration)}，导出前还需裁剪到 0:15 内`
        : `已更新预听：${formatSeconds(rendered.buffer.duration)}`);
    } finally {
      setCommitState('idle');
    }
  }

  async function trimToSelection() {
    if (!selectedSegment || commitState === 'rendering') return;
    pushUndoSnapshot();
    const next = [{ ...selectedSegment, id: `seg-${Date.now()}` }];
    stopPlayback();
    setSegments(next);
    setSelectedId(next[0].id);
    setStatus(`已保留选中部分 ${formatSeconds(selectedDuration)}，正在生成预听`);
    await previewCommittedSegments(next, `已保留选中部分 ${formatSeconds(selectedDuration)}，但需要控制在 15 秒内才能生成预听`);
  }

  async function deleteSelected() {
    if (!selectedSegment || commitState === 'rendering') return;
    const next = [];
    if (segments.length <= 1) {
      if (selectedSegment.start > 0.05) {
        next.push({ ...selectedSegment, id: `seg-${Date.now()}a`, start: 0, end: selectedSegment.start });
      }
      if (sourceDuration - selectedSegment.end > 0.05) {
        next.push({ ...selectedSegment, id: `seg-${Date.now()}b`, start: selectedSegment.end, end: sourceDuration });
      }
    } else {
      next.push(...segments.filter((segment) => segment.id !== selectedSegment.id));
    }
    if (!next.length) {
      setStatus('删除后没有可播放内容，请缩小框选范围');
      return;
    }
    pushUndoSnapshot();
    stopPlayback();
    setSegments(next);
    setSelectedId(next[0]?.id || '');
    setStatus('已删除选中部分，正在生成预听');
    await previewCommittedSegments(next, '已删除选中部分，但剩余内容需要控制在 15 秒内才能生成预听');
  }

  function resetClip() {
    if (!audioBuffer) return;
    pushUndoSnapshot();
    const next = initialSegments(audioBuffer);
    setSegments(next);
    setSelectedId(next[0].id);
    resetRender();
    setStatus('已重置剪辑');
  }

  function resetEffects() {
    pushUndoSnapshot();
    setVolumeDb(0);
    setFadeIn(0);
    setFadeOut(0);
    setSpeed(1);
    setSemitones(0);
    setDenoise(false);
    setDenoiseLevel('light');
    setEnvironmentEffect('raw');
    setVoiceEffect('native');
    resetRender();
    setStatus('已恢复原声效果');
  }

  function clearAll() {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(null);
    setSourceUrl('');
    setAudioBuffer(null);
    setMetadata(null);
    setSegments([]);
    setSelectedId('');
    setUndoStack([]);
    undoGestureRef.current = '';
    setOutputBuffer(null);
    setOutputBlob(null);
    setOutputUrl('');
    setVolumeDb(0);
    setFadeIn(0);
    setFadeOut(0);
    setSpeed(1);
    setSemitones(0);
    setDenoise(false);
    setDenoiseLevel('light');
    setEnvironmentEffect('raw');
    setVoiceEffect('native');
    setPlayhead(0);
    setPreviewState('idle');
    setCommitState('idle');
    setStatus('已清空制梗间');
  }

  function seekToRatio(ratio) {
    if (!previewDuration) return;
    const next = Math.max(0, Math.min(previewDuration, ratio * previewDuration));
    setPlayhead(next);
    if (editorAudioRef.current) editorAudioRef.current.currentTime = next;
  }

  function stopPlayback() {
    const audio = editorAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setPlayhead(0);
    setIsPlaying(false);
  }

  function processingOptions() {
    return {
      volume: dbToGain(volumeDb),
      fadeIn,
      fadeOut,
      speed,
      semitones,
      denoise,
      denoiseLevel,
      environmentEffect,
      voiceEffect,
      outputSampleRate: selectedClarity.rate,
    };
  }

  function guardLength(targetSegments = segments) {
    const total = targetSegments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
    if (total <= MAX_MEME_SECONDS) return true;
    const message = `成品 ${formatSeconds(total)}，已超过 0:15，请先裁剪。`;
    setStatus(message);
    window.alert(message);
    return false;
  }

  async function renderOutput(targetSegments = segments, options = {}) {
    if (!audioBuffer) {
      setStatus('请先导入音频');
      return null;
    }
    if (!options.skipLengthGuard && !guardLength(targetSegments)) return null;
    const runId = previewRunRef.current + 1;
    previewRunRef.current = runId;
    setPreviewState('rendering');
    setStatus('正在生成处理后音频');
    try {
      const rendered = await renderEditedAudio(audioBuffer, targetSegments, processingOptions());
      if (previewRunRef.current !== runId) return null;
      const blob = audioBufferToWavBlob(rendered);
      setOutputBuffer(rendered);
      setOutputBlob(blob);
      setOutputUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(blob);
      });
      setPlayhead(0);
      setPreviewState('ready');
      setStatus(`已生成 ${formatSeconds(rendered.duration)} 的处理后预听`);
      return { buffer: rendered, blob };
    } catch (error) {
      setPreviewState('error');
      setStatus(error.message || '处理失败，请检查参数');
      return null;
    }
  }

  useEffect(() => {
    if (!audioBuffer || !segments.length) return undefined;
    if (isOverLimit) {
      setStatus(overLimitText);
      return undefined;
    }
    setPreviewState('waiting');
    const timer = window.setTimeout(() => {
      renderOutput();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [audioBuffer, segments, volumeDb, fadeIn, fadeOut, speed, semitones, denoise, denoiseLevel, environmentEffect, voiceEffect, clarity]);

  async function downloadOutput() {
    if (!audioBuffer || !guardLength()) return;
    const targetSegments = exportTarget === 'selection' && selectedSegment ? [selectedSegment] : segments;
    const buffer = exportTarget === 'complete' && outputBuffer
      ? outputBuffer
      : await renderEditedAudio(audioBuffer, targetSegments, processingOptions());
    const exportBlob = exportFormat === 'mp3' ? audioBufferToMp3Blob(buffer) : audioBufferToWavBlob(buffer);
    const link = document.createElement('a');
    const downloadUrl = URL.createObjectURL(exportBlob);
    link.href = downloadUrl;
    link.download = `${fields.title || '音梗'}-${exportTarget}.${exportFormat}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setStatus(`已导出 ${exportFormat.toUpperCase()}：请在浏览器下载记录或系统“下载”文件夹查看，也可继续在本页试听处理后效果`);
  }

  function serverConfig() {
    const targetSegments = exportTarget === 'selection' && selectedSegment ? [selectedSegment] : segments;
    return {
      title: fields.title || '音梗',
      exportFormat,
      exportTarget,
      clarity,
      segments: targetSegments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        gain: segment.gain,
        muted: segment.muted,
      })),
      volumeDb,
      fadeIn,
      fadeOut,
      speed,
      semitones,
      denoise,
      denoiseLevel,
      environmentEffect,
      voiceEffect,
    };
  }

  async function downloadServerOutput() {
    if (!file || !guardLength()) return;
    if (engineStatus.state !== 'ready') {
      setStatus('本地音频引擎未启动：请先运行 npm run audio:server，或继续使用浏览器导出。');
      return;
    }
    try {
      setStatus('正在用本地音频引擎处理');
      const response = await fetch(`${audioEngineBaseUrl}/api/audio/process-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: { name: file.name, dataUrl: await blobToDataUrl(file) },
          config: serverConfig(),
        }),
      });
      if (!response.ok) {
        const message = await response.json().catch(() => ({ error: '处理失败' }));
        throw new Error(message.error || '处理失败');
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${fields.title || '音梗'}-${exportTarget}.${exportFormat}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setStatus('本地音频引擎已导出文件，请在浏览器下载记录或系统“下载”文件夹查看');
    } catch (error) {
      setStatus(error.message || '本地音频引擎处理失败');
    }
  }

  async function save() {
    if (!audioBuffer) {
      setStatus('请先选择音频文件');
      return;
    }
    const triggers = fields.trigger.split(/[,，、\n]+/).map((item) => item.trim()).filter(Boolean);
    if (!triggers.length) {
      setStatus('至少需要一个触发词');
      return;
    }
    const rendered = outputBlob && outputBuffer ? { buffer: outputBuffer, blob: outputBlob } : await renderOutput();
    if (!rendered) return;
    const audioUrl = await blobToDataUrl(rendered.blob);
    onSaveCustom({
      id: `custom-${Date.now()}`,
      title: fields.title || triggers[0],
      artist: fields.artist || '自制音效',
      audioUrl,
      duration: formatSeconds(rendered.buffer.duration),
      tone: fields.genre || '自选',
      category: '自选',
      categories: ['自选'],
      genre: fields.genre || '自选',
      triggers,
      source: 'custom',
    }, saveToFavorites);
    setStatus('已保存');
  }

  return (
    <section className="upload-card audio-editor">
      <div className="upload-head">
        <h3>制梗间</h3>
        <label className="file-pill">
          <CloudArrowUp size={16} weight="bold" />
          导入
          <input type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" onChange={chooseFile} />
        </label>
      </div>
      <p>导入 MP3/WAV，剪出 15 秒内的梗曲，边调边听，最后导出或保存。</p>

      <div className="editor-panel">
        <div className="panel-head">
          <strong>导入概览</strong>
          <span>{file?.name || '未导入'}</span>
        </div>
        {metadata ? (
          <div className="audio-meta-grid">
            <span>音频清晰度 <b>{selectedClarity.label}</b></span>
            <span>原始格式 <b>{metadata.format}</b></span>
            <span>成品时长 <b>{formatSeconds(segmentDuration)}</b></span>
            <span>选中时长 <b>{formatSeconds(selectedDuration)}</b></span>
            <span>文件大小 <b>{formatSize(metadata.size)}</b></span>
            <span>节奏音高 <b>自动对齐</b></span>
          </div>
        ) : (
          <div className="editor-empty">选择本地音频后开始制作。</div>
        )}
        <div className={`engine-chip ${engineStatus.state === 'ready' ? 'is-ready' : 'is-offline'}`}>
          <strong>本地音频引擎</strong>
          <span>{engineStatus.state === 'ready' ? '已连接，可本地导出' : '未启动，可浏览器导出'}</span>
        </div>
        <div className="choice-grid three">
          {clarityOptions.map((option) => (
            <button
              type="button"
              key={option.id}
              className={option.id === clarity ? 'is-active' : ''}
              onClick={() => {
                pushUndoSnapshot();
                setClarity(option.id);
                resetRender();
              }}
            >
              <strong>{option.label}</strong>
              <span>{option.detail}</span>
            </button>
          ))}
        </div>
        {isOverLimit && <div className="limit-warning">{overLimitText}</div>}
      </div>

      <div className="editor-monitor">
        <div className="visual-panel">
          <div
            className="waveform-visual"
            aria-label="彩色波形图"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              seekToRatio((event.clientX - rect.left) / Math.max(1, rect.width));
            }}
          >
            {waveform.map((peak, index) => {
              const point = audioBuffer && waveform.length ? ((index + 0.5) / waveform.length) * audioBuffer.duration : 0;
              const highlighted = selectedSegment && point >= selectedSegment.start && point <= selectedSegment.end;
              return <i key={index} className={highlighted ? 'is-selected' : ''} style={{ height: `${Math.max(8, peak * 100)}%` }} />;
            })}
            {playableUrl && <span className="playhead-line" style={{ left: playheadPercent }} aria-hidden="true" />}
          </div>
          <div className="spectrum-visual" aria-label="频谱展示">
            {spectrum.map((peak, index) => <i key={index} style={{ height: `${Math.max(8, peak * 100)}%` }} />)}
          </div>
        </div>

        {playableUrl && (
          <div className="transport-row">
            <audio
              ref={editorAudioRef}
              src={playableUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
            />
            <div className={`preview-chip ${outputUrl ? 'is-ready' : previewState === 'rendering' ? 'is-rendering' : ''}`}>
              <strong>{previewTitle}</strong>
              <span>{previewMessage}</span>
            </div>
            <button type="button" onClick={() => editorAudioRef.current?.play()}><Play size={13} weight="fill" />播放</button>
            <button type="button" onClick={() => editorAudioRef.current?.pause()}><Pause size={13} weight="fill" />暂停</button>
            <button type="button" onClick={stopPlayback}>停止</button>
            <button type="button" onClick={undoEdit} disabled={!undoStack.length}><ArrowCounterClockwise size={13} weight="bold" />撤销</button>
            <input
              type="range"
              min="0"
              max={Math.max(0.1, previewDuration)}
              step="0.1"
              value={Math.min(playhead, Math.max(0.1, previewDuration))}
              onChange={(event) => seekToRatio(Number(event.target.value) / Math.max(0.1, previewDuration))}
            />
            <span>{formatSeconds(playhead)} / {formatSeconds(previewDuration)} {isPlaying ? '播放中' : ''}</span>
          </div>
        )}
      </div>

      <div className="editor-panel">
        <div className="panel-head">
          <strong>音频剪辑</strong>
          <span>上限 0:15</span>
        </div>
        <div className="segment-list">
          {segments.map((segment, index) => (
            <button type="button" key={segment.id} className={segment.id === selectedId ? 'is-active' : ''} onClick={() => setSelectedId(segment.id)}>
              <strong>片段 {index + 1}</strong>
              <span>{formatSeconds(segment.end - segment.start)} {segment.muted ? '静音' : ''}</span>
            </button>
          ))}
        </div>
        {audioBuffer ? (
          <div className="clip-timeline" ref={timelineRef} aria-label="拖动黄色框选范围，保留或删除选中部分">
            <div className="clip-wave">
              <span className="clip-selection-fill" style={{ left: selectionLeftPercent, width: selectionWidthPercent }} aria-hidden="true" />
              {sourceWaveform.map((peak, index) => {
                const point = ((index + 0.5) / Math.max(1, sourceWaveform.length)) * sourceDuration;
                const inRange = selectedSegment && point >= selectedSegment.start && point <= selectedSegment.end;
                return <i key={index} className={inRange ? 'is-selected' : ''} style={{ height: `${Math.max(8, peak * 100)}%` }} />;
              })}
              <span className="playhead-line timeline-playhead" style={{ left: timelinePlayheadPercent }} aria-hidden="true" />
            </div>
            <input
              className="timeline-marker marker-start"
              aria-label="拖动裁剪起点"
              type="range"
              min="0"
              max={timelineMax}
              step="0.05"
              value={selectedStart}
              onChange={(event) => updateTrimStart(event.target.value)}
              onPointerUp={() => endUndoStep('trim-start')}
              onPointerCancel={() => endUndoStep('trim-start')}
              onBlur={() => endUndoStep('trim-start')}
            />
            <input
              className="timeline-marker marker-end"
              aria-label="拖动裁剪终点"
              type="range"
              min="0"
              max={timelineMax}
              step="0.05"
              value={selectedEnd}
              onChange={(event) => updateTrimEnd(event.target.value)}
              onPointerUp={() => endUndoStep('trim-end')}
              onPointerCancel={() => endUndoStep('trim-end')}
              onBlur={() => endUndoStep('trim-end')}
            />
            <div className="timeline-readout">
              <span>起点 {formatSeconds(selectedStart)}</span>
              <span>已选 {formatSeconds(selectedDuration)}</span>
              <span>终点 {formatSeconds(selectedEnd)}</span>
            </div>
          </div>
        ) : (
          <div className="editor-empty">导入音频后显示可拖动时间轴。</div>
        )}
        <div className="editor-grid">
          <label><span>局部音量</span><input type="range" min="0" max="2" step="0.05" value={selectedSegment?.gain ?? 1} onChange={(event) => { beginUndoStep('segment-gain'); updateSelected({ gain: event.target.value }); }} onPointerUp={() => endUndoStep('segment-gain')} onPointerCancel={() => endUndoStep('segment-gain')} onBlur={() => endUndoStep('segment-gain')} /></label>
        </div>
        <div className="clip-workbench">
          <div className="clip-status">
            <span>当前片段</span>
            <strong>{selectedIndex >= 0 ? `片段 ${selectedIndex + 1}` : '未选择'}</strong>
            <small>{clipRangeLabel}</small>
          </div>
          <div className="clip-main-actions">
            <button type="button" className="clip-action clip-primary" onClick={trimToSelection} disabled={!selectedSegment || commitState === 'rendering'}>
              <Scissors size={16} weight="bold" />
              <span className="clip-copy">
                <span>{commitState === 'rendering' ? '生成中...' : '保留选中部分'}</span>
                <small>{selectedSegment ? `立即预听 ${formatSeconds(selectedDuration)}` : '先框选片段'}</small>
              </span>
            </button>
            <button type="button" className="clip-action danger" onClick={deleteSelected} disabled={!selectedSegment || commitState === 'rendering'}>
              <span className="clip-copy">
                <span>删除选中部分</span>
                <small>移除框中内容</small>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="editor-panel">
        <div className="panel-head">
          <strong>基础加工</strong>
          <span>实时预听</span>
        </div>
        <div className="editor-grid">
          <label><span>整体音量 {volumeDb}db</span><input type="range" min="-20" max="10" step="1" value={volumeDb} onChange={(event) => updateWithUndo('volume', setVolumeDb, Number(event.target.value))} onPointerUp={() => endUndoStep('volume')} onPointerCancel={() => endUndoStep('volume')} onBlur={() => endUndoStep('volume')} /></label>
          <label><span>淡入 {fadeIn || 0}秒</span><input type="number" min="0" step="0.1" value={fadeIn} onChange={(event) => updateWithUndo('fade-in', setFadeIn, event.target.value)} onBlur={() => endUndoStep('fade-in')} /></label>
          <label><span>淡出 {fadeOut || 0}秒</span><input type="number" min="0" step="0.1" value={fadeOut} onChange={(event) => updateWithUndo('fade-out', setFadeOut, event.target.value)} onBlur={() => endUndoStep('fade-out')} /></label>
          <label><span>变速 {Number(speed).toFixed(1)}x</span><input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={(event) => updateWithUndo('speed', setSpeed, Number(event.target.value))} onPointerUp={() => endUndoStep('speed')} onPointerCancel={() => endUndoStep('speed')} onBlur={() => endUndoStep('speed')} /></label>
          <label><span>变调 {semitones}</span><input type="range" min="-12" max="12" step="1" value={semitones} onChange={(event) => updateWithUndo('pitch', setSemitones, Number(event.target.value))} onPointerUp={() => endUndoStep('pitch')} onPointerCancel={() => endUndoStep('pitch')} onBlur={() => endUndoStep('pitch')} /></label>
        </div>
        <div className="choice-grid four">
          <button
            type="button"
            className={!denoise ? 'is-active' : ''}
            onClick={() => {
              pushUndoSnapshot();
              setDenoise(false);
              resetRender();
            }}
          >
            <strong>关闭降噪</strong>
          </button>
          {denoiseOptions.map((option) => (
            <button
              type="button"
              key={option.id}
              className={denoise && denoiseLevel === option.id ? 'is-active' : ''}
              onClick={() => {
                pushUndoSnapshot();
                setDenoise(true);
                setDenoiseLevel(option.id);
                resetRender();
              }}
            >
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="editor-panel">
        <div className="panel-head">
          <strong>声音效果</strong>
          <span>回音和变音色可叠加</span>
        </div>
        <div className="effect-block">
          <span>环境声音</span>
          <div className="choice-grid three">
            {environmentOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={environmentEffect === option.id ? 'is-active' : ''}
                onClick={() => {
                  pushUndoSnapshot();
                  setEnvironmentEffect(option.id);
                  resetRender();
                }}
              >
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="effect-block">
          <span>变换人声音色</span>
          <div className="choice-grid three">
            {voiceOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={voiceEffect === option.id ? 'is-active' : ''}
                onClick={() => {
                  pushUndoSnapshot();
                  setVoiceEffect(option.id);
                  resetRender();
                }}
              >
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="editor-panel">
        <div className="panel-head">
          <strong>导出与保存</strong>
          <span>{exportFormat.toUpperCase()}</span>
        </div>
        <div className="choice-grid two">
          {['mp3', 'wav'].map((option) => (
            <button
              type="button"
              key={option}
              className={exportFormat === option ? 'is-active' : ''}
              onClick={() => setExportFormat(option)}
            >
              <strong>{option.toUpperCase()}</strong>
              <span>{option === 'mp3' ? '轻量分享' : '留存素材'}</span>
            </button>
          ))}
        </div>
        <div className="choice-grid two">
          {exportTargetOptions.map((option) => (
            <button
              type="button"
              key={option.id}
              className={exportTarget === option.id ? 'is-active' : ''}
              onClick={() => setExportTarget(option.id)}
              disabled={option.id === 'selection' && !selectedSegment}
            >
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
        <div className="upload-fields">
          <input value={fields.title} onChange={(event) => updateField('title', event.target.value)} placeholder="音梗名" />
          <input value={fields.artist} onChange={(event) => updateField('artist', event.target.value)} placeholder="作者" />
          <input value={fields.trigger} onChange={(event) => updateField('trigger', event.target.value)} placeholder="触发词，用逗号分隔" />
        </div>
        <label className="save-check">
          <input type="checkbox" checked={saveToFavorites} onChange={(event) => setSaveToFavorites(event.target.checked)} />
          <span>保存后加入收藏夹</span>
        </label>
        <div className="edit-actions output-actions">
          <button type="button" onClick={renderOutput} disabled={!audioBuffer}>立即刷新预听</button>
          <button type="button" onClick={downloadOutput} disabled={!audioBuffer}>浏览器导出</button>
          <button type="button" onClick={downloadServerOutput} disabled={!audioBuffer}>本地引擎导出</button>
        </div>
        <small className="export-note">导出后在浏览器下载记录或系统“下载”文件夹查看；处理后声音仍可在上方播放。</small>
        <button type="button" className="save-custom" onClick={save}><Check size={16} weight="bold" />保存到梗库</button>
      </div>

      <div className="reset-actions">
        <button type="button" onClick={resetClip} disabled={!audioBuffer}>剪辑重置</button>
        <button type="button" onClick={resetEffects}>音效重置</button>
        <button type="button" className="danger" onClick={clearAll}>清空</button>
      </div>
      {status && <small className="upload-status">{status}</small>}
    </section>
  );
}

function PublishModal({ tracks, onClose, onSubmit }) {
  const [text, setText] = useState('分享一个刚收藏的梗曲');
  const [trackId, setTrackId] = useState(tracks[0]?.id || '');
  return (
    <div className="modal-layer">
      <form
        className="publish-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(text, trackId);
        }}
      >
        <div className="modal-head">
          <strong>发布动态</strong>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <textarea value={text} onChange={(event) => setText(event.target.value)} />
        <select value={trackId} onChange={(event) => setTrackId(event.target.value)}>
          {tracks.slice(0, 16).map((track) => <option value={track.id} key={track.id}>{track.title} · {track.artist}</option>)}
        </select>
        <button type="submit">发布</button>
      </form>
    </div>
  );
}

function AudioCard({ track, playingKey, playKey, onPlay }) {
  return (
    <button type="button" className="audio-card" onClick={() => onPlay(track, playKey)}>
      <span className="album-art">{playingKey === playKey ? <Pause size={15} weight="fill" /> : <MusicNotes size={17} weight="fill" />}</span>
      <div>
        <strong>{track.title} · {track.artist}</strong>
        <small>{track.category} · {track.duration} · 可加入梗库</small>
      </div>
      <Wave active={playingKey === playKey} compact />
    </button>
  );
}

function Segmented({ active, onScreen }) {
  return (
    <nav className="segmented" aria-label="梗世界页面">
      <button type="button" className={active === 'discover' ? 'is-active' : ''} onClick={() => onScreen('discover')}>推荐</button>
      <button type="button" className={active === 'square' ? 'is-active' : ''} onClick={() => onScreen('square')}>广场</button>
    </nav>
  );
}

function BottomTabs({ active, onScreen }) {
  const items = [
    ['world', '梗世界', GlobeHemisphereEast],
    ['library', '梗库', FolderOpen],
    ['chat', '聊天', Microphone],
  ];
  const activeId = active === 'discover' || active === 'square' ? 'world' : active;
  return (
    <nav className="bottom-tabs" aria-label="底部导航">
      {items.map(([id, label, Icon]) => (
        <button type="button" key={id} className={activeId === id ? 'is-active' : ''} onClick={() => onScreen(id)}>
          <Icon size={17} weight={activeId === id ? 'fill' : 'regular'} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function SectionTitle({ title }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <span><button type="button">‹</button><button type="button">›</button></span>
    </div>
  );
}

function Wave({ active = false, compact = false }) {
  return (
    <span className={`wave ${active ? 'is-active' : ''} ${compact ? 'is-compact' : ''}`} aria-hidden="true">
      {Array.from({ length: compact ? 7 : 12 }, (_, index) => <i key={index} style={{ '--h': (index % 5) + 1 }} />)}
    </span>
  );
}

function Grass() {
  return <div className="grass" aria-hidden="true" />;
}

export default App;
