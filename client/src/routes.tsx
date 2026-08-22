import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { CollectionPage } from './pages/CollectionPage';
import { RequireAuth } from './admin/RequireAuth';

// Lazy so a visitor to a public collection never downloads the admin bundle.
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const DashboardPage = lazy(() => import('./admin/DashboardPage'));
const RecordsListPage = lazy(() => import('./admin/records/RecordsListPage'));
const RecordFormPage = lazy(() => import('./admin/records/RecordFormPage'));
const WishlistPage = lazy(() => import('./admin/WishlistPage'));
const SetupPage = lazy(() => import('./admin/SetupPage'));
const SettingsPage = lazy(() => import('./admin/SettingsPage'));
const AccountPage = lazy(() => import('./admin/AccountPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));

const suspend = (node: JSX.Element): JSX.Element => <Suspense fallback={null}>{node}</Suspense>;

export const router = createBrowserRouter([
  { path: '/', element: suspend(<LandingPage />) },
  // Eager: this is the page most visitors arrive on, so it should not wait on
  // a second round trip for its own chunk.
  { path: '/u/:slug', element: <CollectionPage /> },
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
      { path: 'account', element: suspend(<AccountPage />) },
    ],
  },
]);
