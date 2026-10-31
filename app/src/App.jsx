// Routes. Signed-in screens share <Layout/> so the sidebar never reloads.
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout, PageLoader, projectHome, useApp } from './components/Layout.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Invite } from './pages/Invite.jsx';
import { Login } from './pages/Login.jsx';
import { Projects } from './pages/Projects.jsx';
import { Settings } from './pages/Settings.jsx';
import { Source } from './pages/Source.jsx';
import { Sources } from './pages/Sources.jsx';
import { Tail } from './pages/Tail.jsx';
import { Team } from './pages/Team.jsx';

/** "/" opens the current project's dashboard. */
function Home() {
  const { project } = useApp();
  return <Navigate replace to={project ? projectHome(project.id) : '/projects'} />;
}

/** @param {{ children: import('react').ReactNode }} props */
function NeedsProject({ children }) {
  const { project } = useApp();
  if (!project) return <PageLoader />;
  return children;
}

/** @param {{ title: string, children: import('react').ReactNode }} props */
function Titled({ title, children }) {
  useEffect(() => {
    document.title = title === 'Open Logs' ? title : `${title} · Open Logs`;
  }, [title]);
  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <Titled title="Sign in">
              <Login />
            </Titled>
          }
        />
        <Route
          path="/invite"
          element={
            <Titled title="Join your team">
              <Invite />
            </Titled>
          }
        />
        <Route element={<Layout />}>
          <Route
            index
            element={
              <Titled title="Open Logs">
                <Home />
              </Titled>
            }
          />
          <Route
            path="/projects"
            element={
              <Titled title="Projects">
                <Projects />
              </Titled>
            }
          />
          <Route
            path="/team"
            element={
              <Titled title="Team">
                <Team />
              </Titled>
            }
          />
          <Route
            path="/settings"
            element={
              <Titled title="Settings">
                <Settings />
              </Titled>
            }
          />
          <Route
            path="/dashboard"
            element={
              <Titled title="Dashboard">
                <NeedsProject>
                  <Dashboard />
                </NeedsProject>
              </Titled>
            }
          />
          <Route
            path="/tail"
            element={
              <Titled title="Live tail">
                <NeedsProject>
                  <Tail />
                </NeedsProject>
              </Titled>
            }
          />
          <Route
            path="/sources"
            element={
              <Titled title="Sources">
                <NeedsProject>
                  <Sources />
                </NeedsProject>
              </Titled>
            }
          />
          <Route
            path="/source"
            element={
              <Titled title="Source">
                <NeedsProject>
                  <Source />
                </NeedsProject>
              </Titled>
            }
          />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
