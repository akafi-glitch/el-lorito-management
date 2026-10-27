-- Phase 6: menu, menu categories, and tax categories.
--
-- Source: the owner's menu file (El_Lorito_Menu.xlsx), 206 items, plus (owner decisions, Oct 27, 2026):
-- * Chile con queso: $5.19.
-- * Lunch items are served all day. From 3:00 PM (restaurant time) each lunch item costs $1.00 more.
--   Stored on the Lunch category as data (late_from, late_surcharge_cents), not in code.
-- * The menu's cheese-dip prices (lunch: enchilada +$1.25, burrito +$1.50; combination dinners:
--   enchilada +$1.00, burrito +$1.25) are four ordinary items in a "Cheese dip add-ons" category,
--   so a waiter can add them like any item. There is no modification system (out of scope).
--
-- Money is whole cents (integers); tax rates are basis points (850 = 8.5%). Items are turned off,
-- never deleted, so old tickets can always point at them.

-------------------------------------------------------------------------------
-- Tax
-------------------------------------------------------------------------------
create table public.tax_groups (
  code        text primary key check (code ~ '^[a-z_]{3,20}$'),
  name        text not null unique,
  rate_bp     integer not null check (rate_bp between 0 and 10000),
  sort_order  smallint not null unique
);

insert into public.tax_groups (code, name, rate_bp, sort_order) values
  ('food',   'Food',   850,  1),
  ('liquor', 'Liquor', 1050, 2);

-- Each item has a tax category; the category says which group (and so which rate) it belongs to.
create table public.tax_categories (
  code            text primary key check (code ~ '^[a-z_]{3,20}$'),
  name            text not null unique,
  tax_group_code  text not null references public.tax_groups (code),
  sort_order      smallint not null unique
);

create index tax_categories_group_idx on public.tax_categories (tax_group_code);

insert into public.tax_categories (code, name, tax_group_code, sort_order) values
  ('food',         'Food',                'food',   1),
  ('nonalcoholic', 'Nonalcoholic drinks', 'food',   2),
  ('beer',         'Beer',                'liquor', 3),
  ('cocktail',     'Cocktails',           'liquor', 4);

-------------------------------------------------------------------------------
-- Menu categories
-------------------------------------------------------------------------------
create table public.menu_categories (
  id                    bigint generated always as identity primary key,
  code                  text not null unique check (code ~ '^[a-z0-9-]{2,40}$'),
  name                  text not null unique check (char_length(btrim(name)) between 1 and 60),
  note                  text check (note is null or char_length(note) <= 200),
  sort_order            integer not null unique,
  is_active             boolean not null default true,
  -- Late pricing (Lunch): from this restaurant-local time, each item costs this much more.
  late_from             time,
  late_surcharge_cents  integer check (late_surcharge_cents is null or late_surcharge_cents between 1 and 100000),
  constraint menu_categories_late_pair check ((late_from is null) = (late_surcharge_cents is null))
);

-------------------------------------------------------------------------------
-- Menu items
-------------------------------------------------------------------------------
create table public.menu_items (
  id                 bigint generated always as identity primary key,
  category_id        bigint not null references public.menu_categories (id),
  name               text not null check (char_length(btrim(name)) between 1 and 80),
  description        text check (description is null or char_length(description) <= 400),
  price_cents        integer not null check (price_cents between 0 and 1000000),
  tax_category_code  text not null references public.tax_categories (code),
  is_available       boolean not null default true,
  sort_order         integer not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint menu_items_name_per_category unique (category_id, name),
  constraint menu_items_order_per_category unique (category_id, sort_order)
);

create index menu_items_tax_category_idx on public.menu_items (tax_category_code);

create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- The owner's menu
-------------------------------------------------------------------------------
insert into public.menu_categories (code, name, note, sort_order, late_from, late_surcharge_cents) values
  ('lunch', 'Lunch', 'Lunch items are served all day. From 3:00 PM each lunch item costs $1.00 more.', 1, '15:00', 100),
  ('appetizers', 'Appetizers', null, 2, null, null),
  ('nachos', 'Nachos', null, 3, null, null),
  ('side-orders', 'Side Orders', null, 4, null, null),
  ('a-la-carte', 'A La Carte', null, 5, null, null),
  ('childs-plates', 'Child''s Plates', 'For children age 10 and under; drink included.', 6, null, null),
  ('combination-dinners', 'Combination Dinners', null, 7, null, null),
  ('chicken-dishes', 'Chicken Dishes', null, 8, null, null),
  ('vegetarian-combos', 'Vegetarian Combos', null, 9, null, null),
  ('extras', 'Extras', null, 10, null, null),
  ('cheese-dip-add-ons', 'Cheese dip add-ons', 'Cheese dip added on top of an enchilada or burrito, as printed on the menu.', 11, null, null),
  ('enchiladas', 'Enchiladas', null, 12, null, null),
  ('burritos', 'Burritos', null, 13, null, null),
  ('fajitas', 'Fajitas', null, 14, null, null),
  ('steak', 'Steak', null, 15, null, null),
  ('seafood', 'Seafood', null, 16, null, null),
  ('chicken', 'Chicken', null, 17, null, null),
  ('pork', 'Pork', null, 18, null, null),
  ('favorites', 'Favorites', null, 19, null, null),
  ('dessert', 'Dessert', null, 20, null, null),
  ('soft-drinks', 'Soft Drinks', 'Free refills with meal.', 21, null, null),
  ('other-beverages', 'Other Beverages', null, 22, null, null),
  ('aguas-frescas', 'Aguas Frescas', 'No refills.', 23, null, null),
  ('jarritos-bottled-drinks', 'Jarritos & Bottled Drinks', null, 24, null, null),
  ('beer', 'Beer', null, 25, null, null),
  ('cocktails', 'Cocktails', null, 26, null, null);

insert into public.menu_items (category_id, name, description, price_cents, tax_category_code, sort_order)
select c.id, v.name, v.description, v.price_cents, v.tax_category_code, v.sort_order
from (values
  ('lunch', 'Lunch #1', 'Chile relleno, one taco, guacamole salad, choice of rice or beans', 825, 'food', 1),
  ('lunch', 'Lunch #2', 'One beef burrito, Spanish rice and beans', 799, 'food', 2),
  ('lunch', 'Lunch #3', 'One taco, one enchilada, choice of rice or beans', 760, 'food', 3),
  ('lunch', 'Lunch #4 (Taco Salad)', 'Deep-fried flour tortilla shell filled with beef or chicken, lettuce, tomatoes, grated cheese and sour cream', 749, 'food', 4),
  ('lunch', 'Lunch #5', 'One burrito, one taco and rice', 799, 'food', 5),
  ('lunch', 'Lunch #6', 'Mini chicken chimichanga, rice and beans', 825, 'food', 6),
  ('lunch', 'Lunch #7', 'Chicken quesadilla, rice and beans', 799, 'food', 7),
  ('lunch', 'Lunch #8 (Burrito Supreme)', 'One beef burrito with sauce, topped with lettuce, grated cheese, sour cream and tomatoes', 760, 'food', 8),
  ('lunch', 'Lunch #9', 'One enchilada, rice and chile con queso', 799, 'food', 9),
  ('lunch', 'Lunch #10 (Fajitas)', 'Strips of beef or chicken cooked with onions, bell peppers and tomatoes; served with rice, beans, guacamole salad, sour cream and flour tortillas', 1050, 'food', 10),
  ('lunch', 'Lunch #11 (Chilaquiles)', 'Corn tortilla chips cooked with sauce, chicken and cheese; served with rice and guacamole salad', 925, 'food', 11),
  ('lunch', 'Lunch #12 (Pollo Loco)', 'Boneless chicken breast marinated and served with rice, avocado salad and tortillas', 950, 'food', 12),
  ('lunch', 'Lunch #13', 'Mini chicken chimichanga, chicken enchilada and rice', 850, 'food', 13),
  ('lunch', 'Lunch #14 (Pollo Flameado)', 'Two pieces of chicken topped with chorizo and cheese sauce; served with rice, beans and tortillas', 950, 'food', 14),
  ('appetizers', 'Cheese dip (large)', null, 1200, 'food', 1),
  ('appetizers', 'Cheese dip (medium)', null, 899, 'food', 2),
  ('appetizers', 'Cheese dip (small)', null, 519, 'food', 3),
  ('appetizers', 'Cheese and bean dip', null, 499, 'food', 4),
  ('appetizers', 'Guacamole dip', null, 499, 'food', 5),
  ('appetizers', 'Guacamole salad', null, 519, 'food', 6),
  ('appetizers', 'Chile con queso', null, 519, 'food', 7),
  ('nachos', 'Nachos with cheese', null, 599, 'food', 1),
  ('nachos', 'Nachos with beans', null, 699, 'food', 2),
  ('nachos', 'Nachos with beans and beef', null, 699, 'food', 3),
  ('nachos', 'Nachos with beef', null, 699, 'food', 4),
  ('nachos', 'Nachos with chicken', null, 699, 'food', 5),
  ('nachos', 'Nachos supreme', 'Cheese nachos with ground beef, chicken and beans, topped with lettuce, tomatoes and sour cream', 950, 'food', 6),
  ('nachos', 'Nachos fajita', 'Corn chips smothered with cheese sauce, topped with guacamole, sour cream and choice of beef or chicken cooked with vegetables', 990, 'food', 7),
  ('side-orders', 'Burrito', null, 475, 'food', 1),
  ('side-orders', 'Enchilada', null, 325, 'food', 2),
  ('side-orders', 'Enchilada (flour tortilla)', null, 325, 'food', 3),
  ('side-orders', 'Chalupa (corn tortilla)', null, 525, 'food', 4),
  ('side-orders', 'Taco', null, 235, 'food', 5),
  ('side-orders', 'Taco (soft)', null, 275, 'food', 6),
  ('side-orders', 'Taco carne asada', null, 375, 'food', 7),
  ('side-orders', 'Taco al pastor', null, 425, 'food', 8),
  ('side-orders', 'Order shrimp ceviche', null, 725, 'food', 9),
  ('side-orders', 'Fried flour taco', null, 325, 'food', 10),
  ('side-orders', 'Tamale', null, 325, 'food', 11),
  ('side-orders', 'Chile relleno', null, 399, 'food', 12),
  ('side-orders', 'Refried beans', null, 325, 'food', 13),
  ('side-orders', 'Spanish rice', null, 325, 'food', 14),
  ('side-orders', 'Tostada (corn tortilla)', null, 525, 'food', 15),
  ('side-orders', 'Cheese quesadilla (1)', null, 425, 'food', 16),
  ('side-orders', 'Chicken quesadilla (1)', null, 525, 'food', 17),
  ('side-orders', 'Steak quesadilla (chicken or beef)', null, 650, 'food', 18),
  ('side-orders', 'Poblano relleno', null, 559, 'food', 19),
  ('side-orders', 'Chimichanga', null, 625, 'food', 20),
  ('side-orders', 'Mini chimichanga', null, 525, 'food', 21),
  ('side-orders', 'Rice & beans', null, 425, 'food', 22),
  ('a-la-carte', 'Order of tacos (3)', null, 650, 'food', 1),
  ('a-la-carte', 'Order of soft tacos (3)', null, 750, 'food', 2),
  ('a-la-carte', 'Order of fried flour tacos (3)', null, 850, 'food', 3),
  ('a-la-carte', 'Order of burritos (2)', null, 850, 'food', 4),
  ('a-la-carte', 'Order of enchiladas (3)', null, 850, 'food', 5),
  ('a-la-carte', 'Order of flour enchiladas (3)', null, 860, 'food', 6),
  ('a-la-carte', 'Order of tamales (3)', null, 860, 'food', 7),
  ('a-la-carte', 'Order of fish tacos (3)', null, 900, 'food', 8),
  ('childs-plates', '1. Enchilada, rice and beans', null, 699, 'food', 1),
  ('childs-plates', '2. Taco, rice and beans', null, 699, 'food', 2),
  ('childs-plates', '3. Cheese quesadilla and rice', null, 699, 'food', 3),
  ('childs-plates', '4. Burrito and taco', null, 699, 'food', 4),
  ('childs-plates', '5. Chicken tenders with fries', null, 699, 'food', 5),
  ('childs-plates', '6. Corn dog and fries', null, 699, 'food', 6),
  ('childs-plates', '7. Hamburger and fries', null, 699, 'food', 7),
  ('childs-plates', '8. Grilled cheese and fries', null, 699, 'food', 8),
  ('childs-plates', '9. Pizza and fries', null, 699, 'food', 9),
  ('childs-plates', '10. Mac and cheese and fries', null, 699, 'food', 10),
  ('combination-dinners', 'Combo #1', 'One taco, two enchiladas and rice', 940, 'food', 1),
  ('combination-dinners', 'Combo #2', 'One taco, one enchilada and one chalupa', 940, 'food', 2),
  ('combination-dinners', 'Combo #3', 'One enchilada, one chile relleno, one taco and rice', 940, 'food', 3),
  ('combination-dinners', 'Combo #4', 'Two tacos, one enchilada and chile con queso', 940, 'food', 4),
  ('combination-dinners', 'Combo #5', 'Two enchiladas, rice and beans', 940, 'food', 5),
  ('combination-dinners', 'Combo #6', 'One enchilada, one taco, rice and beans', 940, 'food', 6),
  ('combination-dinners', 'Combo #7', 'One enchilada, one chile relleno, rice and beans', 940, 'food', 7),
  ('combination-dinners', 'Combo #8', 'One enchilada, one tamale, rice and beans', 940, 'food', 8),
  ('combination-dinners', 'Combo #9', 'One taco, one chicken quesadilla and rice', 940, 'food', 9),
  ('combination-dinners', 'Combo #10', 'Two tacos, rice and beans', 940, 'food', 10),
  ('combination-dinners', 'Combo #11', 'One burrito, one taco and one enchilada', 940, 'food', 11),
  ('combination-dinners', 'Combo #12', 'One enchilada, one chicken quesadilla and rice', 940, 'food', 12),
  ('combination-dinners', 'Combo #13', 'One enchilada, one burrito and one chile relleno', 999, 'food', 13),
  ('combination-dinners', 'Combo #14', 'One burrito, one enchilada and chile con queso', 999, 'food', 14),
  ('combination-dinners', 'Combo #15', 'One burrito, one enchilada and one tamale', 999, 'food', 15),
  ('combination-dinners', 'Combo #16', 'One chalupa, one chile relleno and one burrito', 999, 'food', 16),
  ('combination-dinners', 'Combo #17', 'One burrito, one enchilada, rice and beans', 999, 'food', 17),
  ('combination-dinners', 'Combo #18', 'One chalupa, one chile relleno and one enchilada', 999, 'food', 18),
  ('combination-dinners', 'Combo #19', 'One chalupa, one burrito and one enchilada', 999, 'food', 19),
  ('combination-dinners', 'Combo #20', 'One mini ground beef chimi, one taco, rice and beans', 999, 'food', 20),
  ('combination-dinners', 'Combo #21', 'One taco, one burrito and one chalupa', 999, 'food', 21),
  ('combination-dinners', 'Combo #22', 'One burrito, one chile relleno and one taco', 999, 'food', 22),
  ('combination-dinners', 'Combo #23', 'One taco, one burrito, rice and beans', 999, 'food', 23),
  ('combination-dinners', 'Combo #24', 'One burrito, one chile relleno and rice', 999, 'food', 24),
  ('chicken-dishes', 'Taco salad (chicken or beef)', 'Deep-fried flour tortilla shell filled with choice of beef or chicken, lettuce, tomatoes, grated cheese and sour cream', 849, 'food', 1),
  ('chicken-dishes', 'Grilled chicken salad', 'Grilled chicken breast over mixed greens with tomatoes and grated cheese', 950, 'food', 2),
  ('chicken-dishes', 'Poblano relleno', 'Poblano pepper filled with boneless chicken breast and cheese, served with Spanish rice and guacamole salad', 999, 'food', 3),
  ('chicken-dishes', 'Guadalajara', 'Chicken burrito and chicken enchilada, topped with lettuce, tomatoes, sour cream and grated cheese', 999, 'food', 4),
  ('chicken-dishes', 'Taco salad fajita (beef or chicken)', 'Deep-fried flour tortilla shell filled with pieces of fajita meat, lettuce, tomatoes, grated cheese and sour cream', 999, 'food', 5),
  ('vegetarian-combos', 'Vegetarian A', 'Two cheese enchiladas, rice and beans', 940, 'food', 1),
  ('vegetarian-combos', 'Vegetarian B', 'One cheese enchilada, one bean burrito and vegetables', 940, 'food', 2),
  ('vegetarian-combos', 'Vegetarian C', 'Flour tortilla grilled, stuffed with cheese, chopped mushrooms, bell peppers, onions and beans inside; served with rice, sour cream and guacamole salad', 925, 'food', 3),
  ('vegetarian-combos', 'Vegetarian D (Chile Relleno)', 'Poblano pepper filled with Oaxaca cheese, served with rice and guacamole salad', 950, 'food', 4),
  ('vegetarian-combos', 'Vegetarian E (Vegetarian Fajitas)', 'Grilled onions, tomatoes, bell peppers, mushrooms, broccoli and cauliflower; served with rice, beans, guacamole salad, sour cream and tortillas', 1150, 'food', 5),
  ('extras', 'Extras (each)', 'Sour cream, grated cheese, tortillas, jalapenos, pico de gallo or hot sauce', 150, 'food', 1),
  ('cheese-dip-add-ons', 'Cheese dip on lunch enchilada', null, 125, 'food', 1),
  ('cheese-dip-add-ons', 'Cheese dip on lunch burrito', null, 150, 'food', 2),
  ('cheese-dip-add-ons', 'Cheese dip on combo enchilada', null, 100, 'food', 3),
  ('cheese-dip-add-ons', 'Cheese dip on combo burrito', null, 125, 'food', 4),
  ('enchiladas', 'Shrimp enchiladas', 'Two enchiladas topped with green sauce; served with rice, beans, sour cream and guacamole salad', 1099, 'food', 1),
  ('enchiladas', 'Enchiladas verdes', 'Two pork enchiladas topped with green sauce and sour cream; served with rice and guacamole salad', 1099, 'food', 2),
  ('enchiladas', 'Enchilada El Lorito', 'One beef, one chicken and one cheese enchilada topped with lettuce, sour cream and tomatoes, with rice on the side', 1099, 'food', 3),
  ('enchiladas', 'Enchiladas rancheras', 'Two cheese enchiladas topped with shredded beef cooked with tomatoes, onions, bell peppers and enchilada sauce; served with guacamole salad and rice', 999, 'food', 4),
  ('enchiladas', 'Enchiladas supremas', 'One cheese, one chicken, one beef and one bean enchilada topped with red sauce, lettuce, sour cream and guacamole', 1099, 'food', 5),
  ('enchiladas', 'Enchiladas suizas', 'Three chicken enchiladas topped with cheese sauce, green salsa and cilantro; served with rice', 1099, 'food', 6),
  ('burritos', 'Burrito Supreme', 'One burrito with red sauce topped with grated cheese, lettuce and sour cream', 850, 'food', 1),
  ('burritos', 'Burrito Mexicano', 'One burrito with shredded beef cooked with onions and bell peppers; topped with cheese sauce, lettuce, tomatoes and guacamole', 999, 'food', 2),
  ('burritos', 'Burrito California', 'Choice of ground beef, steak or chicken with avocado, rice, beans and lettuce in a 10-inch tortilla topped with cheese sauce', 1099, 'food', 3),
  ('burritos', 'Burrito Verde', 'Pork meat cooked and wrapped in a flour tortilla, topped with green sauce and sour cream; served with rice and beans', 1050, 'food', 4),
  ('burritos', 'Sancho', 'One burrito with choice of chicken, steak or ground beef, rice, beans, lettuce, tomato and sour cream, topped with cheese sauce', 1099, 'food', 5),
  ('fajitas', 'Beef or chicken fajitas', 'Strips of beef or chicken cooked with tomatoes, onions and bell peppers; served with rice, beans, flour tortillas, guacamole salad and sour cream', 1399, 'food', 1),
  ('fajitas', 'Shrimp fajitas', 'Marinated shrimp cooked with tomatoes, onions and bell peppers; served with rice, beans, guacamole salad, flour tortillas and sour cream', 1599, 'food', 2),
  ('fajitas', 'Fajitas Texanas', 'Strips of beef, chicken and 4 shrimp cooked with tomatoes, onions and bell peppers; served with rice, beans, flour tortillas, guacamole salad and sour cream', 1499, 'food', 3),
  ('fajitas', 'Fajitas Tapatias', 'Strips of beef cooked with onions and red bell peppers; served with beans, pico de gallo, sour cream, grated cheese and flour tortillas', 1399, 'food', 4),
  ('fajitas', 'Fajitas El Lorito', 'Strips of beef and chicken, 4 shrimp, pork tips and chorizo, cooked with tomatoes, onions, bell peppers and 2 grilled jalapenos; served with rice, beans, guacamole salad, sour cream and flour tortillas', 2399, 'food', 5),
  ('fajitas', 'Molcajete', 'Thin ribeye steak, boneless chicken breast, 4 shrimp, chorizo, queso fresco, grilled jalapeno, cambray onions and a piece of cactus nopal on a hot rock mortar; served with rice, beans, guacamole salad, sour cream and flour tortillas', 2499, 'food', 6),
  ('steak', 'Especial El Lorito', 'Ribeye steak topped with cooked onions, bell peppers and tomatoes; served with rice, beans and flour tortillas', 1499, 'food', 1),
  ('steak', 'Beef Steak Ranchero', 'Ribeye steak topped with ranch-style sauce; served with rice, beans and flour tortillas', 1499, 'food', 2),
  ('steak', 'Tacos de carne asada', 'Three soft tacos with chunks of beef served with pico de gallo and beans', 1099, 'food', 3),
  ('steak', 'Tacos al pastor', 'Three soft tacos with chunks of beef and pork, cilantro and onions marinated with red sauce; served with rice and beans', 1199, 'food', 4),
  ('steak', 'Carne asada', 'Thin ribeye steak served with grilled onions, rice, beans, guacamole salad and tortillas', 1499, 'food', 5),
  ('steak', 'Chile Colorado', 'Chunks of beef cooked in red sauce; served with rice, beans and flour tortillas', 1099, 'food', 6),
  ('seafood', 'Shrimp quesadilla', 'Grilled flour tortilla stuffed with shrimp and cheese; served with sour cream, guacamole salad and rice', 1099, 'food', 1),
  ('seafood', 'Shrimp chimichanga', 'Grilled shrimp with onions, tomatoes and bell peppers wrapped in a fried flour tortilla; served with rice, beans and guacamole salad', 1149, 'food', 2),
  ('seafood', 'Shrimp cocktail', 'Broiled shrimp mixed with pico de gallo, avocado and special cocktail sauce; served with saltine crackers', 1199, 'food', 3),
  ('seafood', 'Shrimp salad', 'Shrimp, mixed greens, cucumbers and croutons served with choice of dressing', 925, 'food', 4),
  ('seafood', 'El Lorito seafood', 'Grilled tilapia fish topped with four shrimp and pico de gallo; served with vegetables, cheese sauce, rice and tortillas', 1599, 'food', 5),
  ('seafood', 'Grilled tilapia fish', 'Served with rice, avocado salad and tortillas', 1249, 'food', 6),
  ('seafood', 'Camarones a la Diabla', 'Shrimp tossed with spicy red sauce; served with rice, avocado salad and tortillas', 1449, 'food', 7),
  ('seafood', 'Caldo tres mares (sea soup)', 'Broiled tilapia fish, shrimp, crab legs and vegetables; served with flour tortillas', 1599, 'food', 8),
  ('seafood', 'Caldo 7 mares', 'Broiled tilapia fish, shrimp, crab legs, vegetables and seafood medley mix', 1899, 'food', 9),
  ('seafood', 'Arroz con camarones', 'Grilled shrimp over a bed of Mexican rice topped with roasted red bell peppers, melted cheese and guacamole salad', 1099, 'food', 10),
  ('chicken', 'Pollo Loco', 'Dinner serving of marinated boneless chicken breast with rice, avocado salad and tortillas', 1199, 'food', 1),
  ('chicken', 'Pollo Ranchero', 'Boneless chicken breast marinated and topped with grilled onions, tomatoes and bell peppers; served with rice, vegetables and tortillas', 1249, 'food', 2),
  ('chicken', 'Pollo Flameado', 'Three pieces of chicken topped with chorizo and cheese sauce; served with rice, beans and tortillas', 1299, 'food', 3),
  ('chicken', 'Pollo Monterrey', 'Three pieces of boneless chicken breast topped with grilled red bell peppers, onions, mushrooms and grated cheese; served with vegetables, rice and tortillas', 1399, 'food', 4),
  ('chicken', 'Arroz con pollo', 'Grilled chicken over a bed of Mexican rice topped with cheese sauce and served with a cheese quesadilla', 1099, 'food', 5),
  ('pork', 'Carnitas', 'Pork tips, rice, beans and guacamole salad served with tortillas', 1225, 'food', 1),
  ('pork', 'Chile Verde', 'Chunks of pork cooked in green sauce; served with rice, beans and flour tortillas', 1199, 'food', 2),
  ('favorites', 'Special Dinner', 'Chalupa, one chile relleno, one taco, one enchilada and one burrito served with Spanish rice and refried beans', 1399, 'food', 1),
  ('favorites', 'Mar y Tierra', 'Thin ribeye steak, tilapia fish filet topped with pico de gallo and four shrimp; served with vegetables, rice and tortillas', 2099, 'food', 2),
  ('favorites', 'Monterrey', 'Fried flat flour tortilla topped with beans, choice of chicken or ground beef, lettuce, sour cream, pico de gallo, tomatoes and guacamole', 1099, 'food', 3),
  ('favorites', 'Chimichanga', 'Chunks of beef or chicken and refried beans wrapped in a flour tortilla and fried; topped with cheese and served with guacamole salad', 950, 'food', 4),
  ('favorites', 'Quesadilla Grande', 'Flour tortilla grilled and stuffed with cheese, chopped beef and beans; served with guacamole, lettuce, sour cream and rice', 999, 'food', 5),
  ('favorites', 'Taquitos Mexicanos', 'Three rolled and fried corn tortillas stuffed with beef or chicken; served with lettuce, guacamole, sour cream and rice', 999, 'food', 6),
  ('favorites', 'Flautas', 'Two rolled deep-fried flour tortillas, one chicken and one beef; served with rice, guacamole salad, sour cream and cheese dip on top', 1025, 'food', 7),
  ('favorites', 'Huevos Rancheros', 'Three eggs, red or green salsa, rice, beans and tortillas (served anytime)', 950, 'food', 8),
  ('favorites', 'Huevos con Chorizo', 'Three eggs with chorizo, served with rice, beans and tortillas', 950, 'food', 9),
  ('favorites', 'Torta', 'Mexican sandwich with choice of chicken, steak or pork, mayo, lettuce, tomatoes, onion, avocado and jalapenos; served with french fries', 999, 'food', 10),
  ('dessert', 'Fried ice cream', null, 425, 'food', 1),
  ('dessert', 'Sopapilla (4)', null, 375, 'food', 2),
  ('dessert', 'Flan (Mexican custard) (1)', null, 375, 'food', 3),
  ('soft-drinks', 'Soft drink', 'Coke, Coke Zero, Diet Coke, Pibb, Fanta (Orange), Sprite, Root Beer, Cream Soda, Minute Maid Lemonade or Raspberry Tea', 299, 'nonalcoholic', 1),
  ('other-beverages', 'Sweet tea', null, 299, 'nonalcoholic', 1),
  ('other-beverages', 'Unsweet tea', null, 299, 'nonalcoholic', 2),
  ('other-beverages', 'Coffee', null, 299, 'nonalcoholic', 3),
  ('other-beverages', 'Milk', 'No refills', 299, 'nonalcoholic', 4),
  ('other-beverages', 'Hot tea', 'No refills', 250, 'nonalcoholic', 5),
  ('other-beverages', 'Hot chocolate', 'No refills', 250, 'nonalcoholic', 6),
  ('aguas-frescas', 'Horchata', null, 325, 'nonalcoholic', 1),
  ('aguas-frescas', 'Jamaica', null, 325, 'nonalcoholic', 2),
  ('aguas-frescas', 'Tamarindo', null, 325, 'nonalcoholic', 3),
  ('jarritos-bottled-drinks', 'Jarritos tamarind', null, 299, 'nonalcoholic', 1),
  ('jarritos-bottled-drinks', 'Jarritos mandarin', null, 299, 'nonalcoholic', 2),
  ('jarritos-bottled-drinks', 'Jarritos fruit punch', null, 299, 'nonalcoholic', 3),
  ('jarritos-bottled-drinks', 'Jarritos pineapple', null, 299, 'nonalcoholic', 4),
  ('jarritos-bottled-drinks', 'Jarritos lime', null, 299, 'nonalcoholic', 5),
  ('jarritos-bottled-drinks', 'Jarritos mango', null, 299, 'nonalcoholic', 6),
  ('jarritos-bottled-drinks', 'Sidral Mundet', null, 299, 'nonalcoholic', 7),
  ('jarritos-bottled-drinks', 'Sangria Senorial', null, 299, 'nonalcoholic', 8),
  ('jarritos-bottled-drinks', 'Mineragua', null, 299, 'nonalcoholic', 9),
  ('jarritos-bottled-drinks', 'Squirt', null, 299, 'nonalcoholic', 10),
  ('jarritos-bottled-drinks', 'Coca-Cola bottle', null, 325, 'nonalcoholic', 11),
  ('beer', 'Domestic beer', 'Bud Light, Budweiser, Miller Light, Coors Light or Michelob Ultra', 499, 'beer', 1),
  ('beer', 'Import beer', 'Blue Moon, Corona, Modelo Especial, Negra Modelo, Sol, Pacifico, XX Lager, Tecate, XX Amber or Carta Blanca', 525, 'beer', 2),
  ('beer', 'Micheladas', 'Listed separately in imported beer selection', 650, 'beer', 3),
  ('beer', 'Draft beer - 12 oz', 'Bud Light, Budweiser, Michelob Ultra, Coors Light or Miller Light', 325, 'beer', 4),
  ('beer', 'Draft beer - 32 oz', 'Bud Light, Budweiser, Michelob Ultra, Coors Light or Miller Light', 575, 'beer', 5),
  ('beer', 'Import draft beer - 12 oz', 'XX Amber, XX Lager, Negra Modelo, Pacifico or Modelo Especial', 399, 'beer', 6),
  ('beer', 'Import draft beer - 32 oz', 'XX Amber, XX Lager, Negra Modelo, Pacifico or Modelo Especial', 799, 'beer', 7),
  ('cocktails', 'Glass wine', 'Merlot, Sangria, White Zinfandel, Cabernet Sauvignon or Chardonnay', 425, 'cocktail', 1),
  ('cocktails', 'Flavored margarita (large)', 'Peach, strawberry or mango', 775, 'cocktail', 2),
  ('cocktails', 'Lime margarita (large)', 'Frozen or on the rocks', 699, 'cocktail', 3),
  ('cocktails', 'Lime margarita (small)', 'On the rocks', 275, 'cocktail', 4),
  ('cocktails', 'Raspberry margarita', null, 775, 'cocktail', 5),
  ('cocktails', 'Blue margarita', null, 699, 'cocktail', 6),
  ('cocktails', 'Pina colada', null, 875, 'cocktail', 7),
  ('cocktails', 'Mangoneada', null, 875, 'cocktail', 8),
  ('cocktails', 'Strawberry daiquiri', null, 875, 'cocktail', 9),
  ('cocktails', 'Mojito', null, 575, 'cocktail', 10),
  ('cocktails', 'Bahamama', null, 625, 'cocktail', 11),
  ('cocktails', 'Long Island ice tea', null, 625, 'cocktail', 12),
  ('cocktails', 'Miami Vice', null, 875, 'cocktail', 13),
  ('cocktails', 'Blue Hawaiian', null, 575, 'cocktail', 14),
  ('cocktails', 'White Russian', null, 575, 'cocktail', 15),
  ('cocktails', 'Amaretto cherry sour', null, 525, 'cocktail', 16),
  ('cocktails', 'Cantarito', null, 625, 'cocktail', 17),
  ('cocktails', 'Vampiro', null, 575, 'cocktail', 18),
  ('cocktails', 'Bloody Mary', null, 625, 'cocktail', 19),
  ('cocktails', 'Corona Rita', null, 875, 'cocktail', 20),
  ('cocktails', 'Paloma', null, 575, 'cocktail', 21),
  ('cocktails', 'Tequila Sunrise', null, 525, 'cocktail', 22)
) as v (category_code, name, description, price_cents, tax_category_code, sort_order)
join public.menu_categories c on c.code = v.category_code;

-------------------------------------------------------------------------------
-- Audit: menu changes
-------------------------------------------------------------------------------
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'seated', 'chips_served', 'cleared', 'section_opened', 'section_closed',
  'shift_started', 'assignment_changed', 'employee_added', 'employee_changed',
  'account_added', 'account_changed', 'menu_item_changed'
));

-------------------------------------------------------------------------------
-- update_menu_item: change the current price and/or turn an item on or off.
-- Old tickets keep the price they were made with (copied onto the ticket from Phase 7).
-- Returns the item's name (for the confirmation message). Errors: menu_item_not_found
-------------------------------------------------------------------------------
create function public.update_menu_item(
  p_item_id      bigint,
  p_price_cents  integer,
  p_is_available boolean,
  p_actor        uuid
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_before public.menu_items%rowtype;
begin
  select * into v_before from public.menu_items where id = p_item_id for update;
  if not found then
    raise exception 'menu_item_not_found' using detail = p_item_id::text;
  end if;

  if v_before.price_cents = p_price_cents and v_before.is_available = p_is_available then
    return v_before.name; -- nothing changed
  end if;

  update public.menu_items
     set price_cents = p_price_cents, is_available = p_is_available
   where id = p_item_id;

  insert into public.audit_events (actor_id, event_type, details)
  values (p_actor, 'menu_item_changed', jsonb_build_object(
    'item', p_item_id,
    'name', v_before.name,
    'price_cents', jsonb_build_object('from', v_before.price_cents, 'to', p_price_cents),
    'available', jsonb_build_object('from', v_before.is_available, 'to', p_is_available)));
  return v_before.name;
end;
$$;

-------------------------------------------------------------------------------
-- Security: RLS on, no browser policies; the function is for the server role only.
-------------------------------------------------------------------------------
alter table public.tax_groups enable row level security;
alter table public.tax_categories enable row level security;
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;

revoke all on table public.tax_groups, public.tax_categories, public.menu_categories, public.menu_items
from anon, authenticated;

revoke execute on function public.update_menu_item(bigint, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.update_menu_item(bigint, integer, boolean, uuid) to service_role;
