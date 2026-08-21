import { Footer } from '../components/Footer';
import { NavBar } from '../components/NavBar';
import { AudioSetup } from '../sections/AudioSetup';
import { CollectionHighlights } from '../sections/CollectionHighlights';
import { Contact } from '../sections/Contact';
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
  return (
    <>
      <NavBar />
      <main>
        <Hero />
        <QuickStats />
        <CollectionHighlights />
        <RecentlyAdded />
        {showSetup && <AudioSetup />}
        {showWishlist && <Wishlist />}
        <Contact />
      </main>
      <Footer />
    </>
  );
}
