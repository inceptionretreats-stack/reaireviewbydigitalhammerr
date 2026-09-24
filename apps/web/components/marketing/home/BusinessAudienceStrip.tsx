import styles from './BusinessAudienceStrip.module.css';
import { BusinessAudienceIcon, type BusinessIconName } from './BusinessAudienceIcons';

const BUSINESS_TYPES = [
  { name: 'Grocery shops', icon: 'basket' },
  { name: 'Iron & steel shops', icon: 'beam' },
  { name: 'Offices', icon: 'building' },
  { name: 'Shopping malls', icon: 'bag' },
  { name: 'Dry cleaners', icon: 'cleaning' },
  { name: 'Restaurants', icon: 'utensils' },
  { name: 'Cafés', icon: 'cup' },
  { name: 'Bakeries', icon: 'bread' },
  { name: 'Sweet shops', icon: 'candy' },
  { name: 'Hotels', icon: 'bed' },
  { name: 'Salons', icon: 'scissors' },
  { name: 'Spas', icon: 'spa' },
  { name: 'Clothing stores', icon: 'shirt' },
  { name: 'Boutiques', icon: 'hanger' },
  { name: 'Jewellery stores', icon: 'gem' },
  { name: 'Shoe stores', icon: 'shoe' },
  { name: 'Hardware shops', icon: 'hammer' },
  { name: 'Electrical shops', icon: 'bolt' },
  { name: 'Mobile stores', icon: 'phone' },
  { name: 'Electronics shops', icon: 'chip' },
  { name: 'Furniture stores', icon: 'sofa' },
  { name: 'Home décor stores', icon: 'lamp' },
  { name: 'Pharmacies', icon: 'medical' },
  { name: 'Clinics', icon: 'stethoscope' },
  { name: 'Dental clinics', icon: 'tooth' },
  { name: 'Hospitals', icon: 'hospital' },
  { name: 'Gyms', icon: 'dumbbell' },
  { name: 'Yoga studios', icon: 'yoga' },
  { name: 'Schools', icon: 'school' },
  { name: 'Coaching centres', icon: 'coaching' },
  { name: 'Bookstores', icon: 'book' },
  { name: 'Stationery shops', icon: 'pencil' },
  { name: 'Florists', icon: 'flower' },
  { name: 'Gift shops', icon: 'gift' },
  { name: 'Pet stores', icon: 'paw' },
  { name: 'Veterinary clinics', icon: 'veterinary' },
  { name: 'Car dealerships', icon: 'car' },
  { name: 'Garages', icon: 'wrench' },
  { name: 'Bike showrooms', icon: 'bicycle' },
  { name: 'Car washes', icon: 'droplet' },
  { name: 'Real estate offices', icon: 'house' },
  { name: 'Travel agencies', icon: 'plane' },
  { name: 'Event planners', icon: 'calendar' },
  { name: 'Photography studios', icon: 'camera' },
  { name: 'Tailors', icon: 'tailor' },
  { name: 'Laundries', icon: 'washer' },
  { name: 'Printing shops', icon: 'printer' },
  { name: 'Local service businesses', icon: 'pin' },
] as const satisfies readonly { name: string; icon: BusinessIconName }[];

const businessNames = BUSINESS_TYPES.map(({ name, icon }) => (
  <li className={styles.businessName} key={name}>
    <span className={styles.businessLabel}>
      <span className={styles.businessIcon} aria-hidden="true">
        <BusinessAudienceIcon name={icon} />
      </span>
      {name}
    </span>
  </li>
));

const originalBusinessList = (
  <ul className={styles.list} data-business-list role="list">
    {businessNames}
  </ul>
);

const repeatedBusinessList = (
  <ul className={styles.list} data-business-list-copy aria-hidden="true">
    {businessNames}
  </ul>
);

export function BusinessAudienceStrip() {
  return (
    <section className={styles.strip} aria-label="Business types" data-business-audience>
      <div
        className={styles.viewport}
        data-business-marquee
        tabIndex={0}
        role="region"
        aria-label="Business types; scrolling stops on hover or keyboard focus"
      >
        <div className={styles.track} id="business-audience-track" data-business-track>
          {originalBusinessList}
          {repeatedBusinessList}
        </div>
      </div>
    </section>
  );
}
