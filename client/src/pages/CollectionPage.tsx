import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { collectionApi, getProfile } from '../api/client';
import { Footer } from '../components/Footer';
import { NavBar } from '../components/NavBar';
import { useResource } from '../hooks/useResource';
import { AudioSetup } from '../sections/AudioSetup';
import { CollectionHighlights } from '../sections/CollectionHighlights';
import { Hero } from '../sections/Hero';
import { QuickStats } from '../sections/QuickStats';
import { RecentlyAdded } from '../sections/RecentlyAdded';
import { Wishlist } from '../sections/Wishlist';
import { NotFoundPage } from './NotFoundPage';

/** Below this, a collection is too thin to be worth indexing. */
const INDEX_THRESHOLD = 3;

/**
 * Sets or clears the robots meta tag for the life of the page.
 *
 * A newly created account with one link should not be indexable. Honest about
 * its limits: the app is client-rendered, so this is a tag React writes on
 * mount — Google executes JS and honours it, some other crawlers do not. The
 * rel="nofollow ugc" on the links themselves is the load-bearing part.
 */
function useNoIndex(shouldHide: boolean): void {
  useEffect(() => {
    if (!shouldHide) {
      return;
    }
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [shouldHide]);
}

export function CollectionPage(): JSX.Element {
  const { slug = '' } = useParams();

  // Memoised on the slug: useResource holds its fetcher in a ref, but a fresh
  // api object every render would still churn the effect this feeds.
  const api = useMemo(() => collectionApi({ kind: 'public', slug }), [slug]);
  const profileFetcher = useMemo(() => () => getProfile(slug), [slug]);
  const profile = useResource(profileFetcher);

  const allRecords = useResource(api.getRecords);
  const recent = useResource(api.getRecentRecords);
  const stats = useResource(api.getStats);
  const genres = useResource(api.getGenres);
  const wishlist = useResource(api.getWishlist);
  const setup = useResource(api.getSetup);
  const settings = useResource(api.getSettings);

  const total = stats.data?.totalRecords ?? 0;
  useNoIndex(profile.data !== null && total < INDEX_THRESHOLD);

  useEffect(() => {
    if (profile.data) {
      // The wordmark stays "Grooves & Dust" on the page itself; the tab is
      // where one collection has to be distinguishable from another.
      document.title = `${profile.data.displayName} · Grooves & Dust`;
    }
  }, [profile.data]);

  if (profile.loading) {
    return <></>;
  }

  // Unknown, private and suspended are one answer from the server, so they are
  // one screen here.
  if (profile.error || !profile.data) {
    return <NotFoundPage />;
  }

  return (
    <>
      <NavBar />
      <main>
        <Hero stats={stats.data} settings={settings.data} />
        <QuickStats stats={stats.data} />
        <CollectionHighlights
          records={allRecords.data ?? []}
          genres={genres.data ?? []}
          total={total}
          error={allRecords.error}
        />
        <RecentlyAdded
          records={recent.data ?? []}
          total={total}
          windowLabel={
            stats.data
              ? `Last 30 days · ${stats.data.addedLast30Days === 1 ? '1 record' : `${stats.data.addedLast30Days} records`}`
              : ''
          }
          error={recent.error}
        />
        <AudioSetup items={setup.data ?? []} settings={settings.data} error={setup.error} />
        <Wishlist items={wishlist.data ?? []} error={wishlist.error} />
      </main>
      <Footer />
    </>
  );
}
