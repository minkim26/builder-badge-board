import { lazy, Suspense, useEffect, useState } from 'react';
import PublicPage from './PublicPage';

// Loaded on demand so public visitors don't download the admin, auth and
// resource-manager code.
const AdminPage = lazy(() => import('./AdminPage'));

// Hash routing instead of react-router: avoids needing an Amplify Hosting
// rewrite rule for client-side paths.
export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const isAdmin = hash === '#admin';

  return (
    <div className="app">
      <nav>
        <a href="#">Home</a>
        <a href="#admin">Admin</a>
      </nav>
      <Suspense fallback={<p role="status">Loading...</p>}>
        {isAdmin ? <AdminPage /> : <PublicPage />}
      </Suspense>
    </div>
  );
}
