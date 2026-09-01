import { useEffect, useState } from 'react';
import Sidebar, { type PageKey } from './components/Sidebar';
import { getMe, getWorks } from './lib/api';
import { isVideoGenerating } from './lib/workStatus';
import CharactersPage from './pages/CharactersPage';
import ImagePage from './pages/ImagePage';
import ModelsPage from './pages/ModelsPage';
import ScriptPage from './pages/ScriptPage';
import VideoEditPage from './pages/VideoEditPage';
import VideoPage from './pages/VideoPage';
import WorksPage from './pages/WorksPage';
import type { Shot, User, Work } from './types';

export default function App() {
  const pageFromHash = () => {
    const key = window.location.hash.replace('#', '') as PageKey;
    if (['script', 'image', 'video', 'edit', 'characters', 'works', 'models'].includes(key)) return key;
    if (window.location.pathname.startsWith('/aigc/image/')) return 'image';
    return 'script';
  };
  const [page, setPage] = useState<PageKey>(pageFromHash);
  const [user, setUser] = useState<User | null>(null);
  const [scriptWork, setScriptWork] = useState<Work | null>(null);
  const [imageWork, setImageWork] = useState<Work | null>(null);
  const [videoWorks, setVideoWorks] = useState<Work[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);

  useEffect(() => {
    void getMe().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const handleHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (page !== 'video' || !videoWorks.some(isVideoGenerating)) return;
    const timer = window.setInterval(() => {
      void getWorks('video').then((works) => {
        setVideoWorks((currentWorks) =>
          currentWorks.map((currentWork) => works.find((work) => work.id === currentWork.id) || currentWork),
        );
      });
    }, 10000);
    return () => window.clearInterval(timer);
  }, [page, videoWorks]);

  const changePage = (nextPage: PageKey) => {
    setPage(nextPage);
    window.location.hash = nextPage;
  };

  return (
    <div className="min-h-screen">
      <Sidebar active={page} user={user} onChange={changePage} />
      <main className="ml-[250px] min-h-screen p-8">
        {page === 'script' ? (
          <ScriptPage
            scriptWork={scriptWork}
            shots={shots}
            onScriptGenerated={(work, parsedShots) => {
              setScriptWork(work);
              setShots(parsedShots);
            }}
            onGoImage={() => changePage('image')}
            onGoVideo={() => changePage('video')}
          />
        ) : null}
        {page === 'image' ? (
          <ImagePage
            shots={shots}
            onShotsChange={setShots}
            onImagesGenerated={(work, nextShots) => {
              setImageWork(work);
              setShots(nextShots);
            }}
            onGoVideo={() => changePage('video')}
          />
        ) : null}
        {page === 'video' ? (
          <VideoPage
            shots={shots}
            videoWorks={videoWorks}
            onShotsChange={setShots}
            onVideoGenerated={(work) => setVideoWorks((items) => {
              const exists = items.some((item) => item.id === work.id);
              if (exists) return items.map((item) => (item.id === work.id ? work : item));
              return [work, ...items];
            })}
          />
        ) : null}
        {page === 'edit' ? <VideoEditPage /> : null}
        {page === 'characters' ? <CharactersPage /> : null}
        {page === 'works' ? <WorksPage /> : null}
        {page === 'models' ? <ModelsPage /> : null}
      </main>
    </div>
  );
}
