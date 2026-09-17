import styles from './BusinessAudienceStrip.module.css';

const BUSINESS_TYPES = [
  'Grocery shops',
  'Iron & steel shops',
  'Offices',
  'Shopping malls',
  'Dry cleaners',
  'Restaurants',
  'Cafés',
  'Bakeries',
  'Sweet shops',
  'Hotels',
  'Salons',
  'Spas',
  'Clothing stores',
  'Boutiques',
  'Jewellery stores',
  'Shoe stores',
  'Hardware shops',
  'Electrical shops',
  'Mobile stores',
  'Electronics shops',
  'Furniture stores',
  'Home décor stores',
  'Pharmacies',
  'Clinics',
  'Dental clinics',
  'Hospitals',
  'Gyms',
  'Yoga studios',
  'Schools',
  'Coaching centres',
  'Bookstores',
  'Stationery shops',
  'Florists',
  'Gift shops',
  'Pet stores',
  'Veterinary clinics',
  'Car dealerships',
  'Garages',
  'Bike showrooms',
  'Car washes',
  'Real estate offices',
  'Travel agencies',
  'Event planners',
  'Photography studios',
  'Tailors',
  'Laundries',
  'Printing shops',
  'Local service businesses',
] as const;

const businessNames = BUSINESS_TYPES.map((business) => (
  <li className={styles.businessName} key={business}>
    {business}
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
