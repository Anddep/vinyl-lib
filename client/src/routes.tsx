import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { RequireAuth } from './admin/RequireAuth';

// Lazy so a visitor to the public homepage never downloads the admin bundle.
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const LoginPage = lazy(() => import('./admin/LoginPage'));
const DashboardPage = lazy(() => import('./admin/DashboardPage'));
const RecordsListPage = lazy(() => import('./admin/records/RecordsListPage'));
const RecordFormPage = lazy(() => import('./admin/records/RecordFormPage'));
const WishlistPage = lazy(() => import('./admin/WishlistPage'));
const SetupPage = lazy(() => import('./admin/SetupPage'));
const SettingsPage = lazy(() => import('./admin/SettingsPage'));

const suspend = (node: JSX.Element): JSX.Element => <Suspense fallback={null}>{node}</Suspense>;

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/admin/login', element: suspend(<LoginPage />) },
  {
    path: '/admin',
    element: suspend(
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>,
    ),
    children: [
      { index: true, element: suspend(<DashboardPage />) },
      { path: 'records', element: suspend(<RecordsListPage />) },
      { path: 'records/new', element: suspend(<RecordFormPage />) },
      { path: 'records/:id', element: suspend(<RecordFormPage />) },
      { path: 'wishlist', element: suspend(<WishlistPage />) },
      { path: 'setup', element: suspend(<SetupPage />) },
      { path: 'settings', element: suspend(<SettingsPage />) },
    ],
  },
]);
