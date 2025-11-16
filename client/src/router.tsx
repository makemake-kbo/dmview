import { createBrowserRouter } from 'react-router-dom';
import DMView from './views/DMView';
import LandingView from './views/LandingView';
import ProjectorView from './views/ProjectorView';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingView />,
  },
  {
    path: '/dm/:sessionId',
    element: <DMView />,
  },
  {
    path: '/projector/:sessionId',
    element: <ProjectorView />,
  },
]);
