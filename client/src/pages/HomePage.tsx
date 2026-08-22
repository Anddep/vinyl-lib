import {
  getFeaturedRecords,
  getGenres,
  getRecentRecords,
  getSettings,
  getSetup,
  getStats,
  getWishlist,
} from '../api/client';
import { Footer } from '../components/Footer';
import { NavBar } from '../components/NavBar';
import { useResource } from '../hooks/useResource';
import { AudioSetup } from '../sections/AudioSetup';
import { CollectionHighlights } from '../sections/CollectionHighlights';
import { Hero } from '../sections/Hero';
import { QuickStats } from '../sections/QuickStats';
import { RecentlyAdded } from '../sections/RecentlyAdded';
import { Wishlist } from '../sections/Wishlist';

interface HomePageProps {
  /** Prop-gated optional sections, mirroring the design's preview flags. */
  showSetup?: boolean;
  showWishlist?: boolean;
}

export function HomePage({ showSetup = true, showWishlist = true }: HomePageProps): JSX.Element {
  // One fetch per section rather than one aggregate call: a slow or failing
  // endpoint then degrades only its own band.
  const featured = useResource(getFeaturedRecords);
  const recent = useResource(getRecentRecords);
  const stats = useResource(getStats);
  const genres = useResource(getGenres);
  const wishlist = useResource(getWishlist);
  const setup = useResource(getSetup);
  const settings = useResource(getSettings);

  return (
    <>
      <NavBar />
      <main>
        <Hero stats={stats.data} settings={settings.data} />
        <QuickStats stats={stats.data} />
        <CollectionHighlights
          records={featured.data ?? []}
          genres={genres.data ?? []}
          total={stats.data?.totalRecords ?? 0}
          error={featured.error}
        />
        <RecentlyAdded
          records={recent.data ?? []}
          total={stats.data?.totalRecords ?? 0}
          windowLabel={
            stats.data
              ? `Last 30 days · ${stats.data.addedLast30Days === 1 ? '1 record' : `${stats.data.addedLast30Days} records`}`
              : ''
          }
          error={recent.error}
        />
        {showSetup && (
          <AudioSetup items={setup.data ?? []} settings={settings.data} error={setup.error} />
        )}
        {showWishlist && <Wishlist items={wishlist.data ?? []} error={wishlist.error} />}
      </main>
      <Footer />
    </>
  );
}
