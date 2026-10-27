export type NavDestination = {
  href: "/floor" | "/waiter" | "/manage";
  label: string;
  description: string;
};

/** The two main jobs on the home page, in the order staff use them most. */
export const primaryDestinations: readonly NavDestination[] = [
  {
    href: "/floor",
    label: "Floor Management",
    description: "Seat guests, track chips, clear tables.",
  },
  {
    href: "/waiter",
    label: "Waiter Section",
    description: "Enter your number, choose a table, print a ticket.",
  },
];

/** Operational settings, kept out of the way of the two main buttons. */
export const managementDestination: NavDestination = {
  href: "/manage",
  label: "Management",
  description: "Sections, staff, shifts, and accounts.",
};

export const allDestinations: readonly NavDestination[] = [...primaryDestinations, managementDestination];
