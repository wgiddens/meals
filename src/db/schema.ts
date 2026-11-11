import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * How much effort a recipe takes on a weeknight. "Time" is tracked separately
 * (prep + cook minutes); complexity is about attention and number of moving
 * parts, which matters just as much when planning.
 */
export const complexityEnum = pgEnum("complexity", ["easy", "medium", "hard"]);

/** Grocery-store aisle groupings used to sort the shopping list. */
export const ingredientCategoryEnum = pgEnum("ingredient_category", [
  "produce",
  "meat",
  "seafood",
  "dairy",
  "bakery",
  "frozen",
  "pantry",
  "spices",
  "beverages",
  "other",
]);

export const ingredientCategories = ingredientCategoryEnum.enumValues;
export const complexities = complexityEnum.enumValues;

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    sourceUrl: text("source_url"),
    /** Where this came from: "family", "web", "photo", "ai". Free text. */
    source: text("source"),
    servings: integer("servings"),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    complexity: complexityEnum("complexity").notNull().default("medium"),
    /** 1-5 family rating. How much did everyone actually enjoy it? */
    rating: integer("rating"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Free-form, numbered steps separated by blank lines. */
    instructions: text("instructions"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("recipes_title_idx").on(t.title)],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 3 }),
    unit: text("unit"),
    /** e.g. "diced", "optional", "to taste" */
    note: text("note"),
    category: ingredientCategoryEnum("category").notNull().default("other"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("recipe_ingredients_recipe_idx").on(t.recipeId)],
);

/**
 * One row per (date, meal). Supper is the meal that matters for this family,
 * but the column leaves room for lunch/breakfast later. A planned meal either
 * points at a recipe or carries a free-text note ("leftovers", "pizza night").
 */
export const plannedMeals = pgTable(
  "planned_meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    meal: text("meal").notNull().default("supper"),
    recipeId: uuid("recipe_id").references(() => recipes.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    cooked: boolean("cooked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("planned_meals_date_meal_idx").on(t.date, t.meal)],
);

export const groceryLists = pgTable("grocery_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The plan window this list was built from. */
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const groceryItems = pgTable(
  "grocery_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => groceryLists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 3 }),
    unit: text("unit"),
    category: ingredientCategoryEnum("category").notNull().default("other"),
    /** "plan" items are regenerated from the meal plan; "manual" ones stick. */
    source: text("source").notNull().default("plan"),
    /** Titles of the recipes that need this item, for context while shopping. */
    forRecipes: text("for_recipes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    checked: boolean("checked").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("grocery_items_list_idx").on(t.listId)],
);

export const recipesRelations = relations(recipes, ({ many }) => ({
  ingredients: many(recipeIngredients),
  plannedMeals: many(plannedMeals),
}));

export const recipeIngredientsRelations = relations(
  recipeIngredients,
  ({ one }) => ({
    recipe: one(recipes, {
      fields: [recipeIngredients.recipeId],
      references: [recipes.id],
    }),
  }),
);

export const plannedMealsRelations = relations(plannedMeals, ({ one }) => ({
  recipe: one(recipes, {
    fields: [plannedMeals.recipeId],
    references: [recipes.id],
  }),
}));

export const groceryListsRelations = relations(groceryLists, ({ many }) => ({
  items: many(groceryItems),
}));

export const groceryItemsRelations = relations(groceryItems, ({ one }) => ({
  list: one(groceryLists, {
    fields: [groceryItems.listId],
    references: [groceryLists.id],
  }),
}));

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type NewRecipeIngredient = typeof recipeIngredients.$inferInsert;
export type PlannedMeal = typeof plannedMeals.$inferSelect;
export type GroceryList = typeof groceryLists.$inferSelect;
export type GroceryItem = typeof groceryItems.$inferSelect;
export type Complexity = (typeof complexities)[number];
export type IngredientCategory = (typeof ingredientCategories)[number];

/* -------------------------------------------------------------------------
 * Accounts (Better Auth)
 *
 * These tables (and `passkey` below) belong to the sign-in library. Their
 * property names and types must match what Better Auth expects (see `getAuth()` in
 * src/lib/auth.ts); column names follow this file's snake_case convention.
 * Ids are strings generated by the library.
 * ---------------------------------------------------------------------- */

/** What a family member may do. Only the owner manages the family. */
export const userRoleEnum = pgEnum("user_role", ["owner", "member"]);
export const userRoles = userRoleEnum.enumValues;

/**
 * A person who can sign in. Every user is a member of the one family.
 *
 * `role` is set by the before-create hook in src/lib/auth.ts and is declared
 * to Better Auth as a server-only field, so no client endpoint can set or
 * change it. The database default only covers rows that predate the column;
 * it is the least-privileged value. A partial unique index allows at most one
 * owner, so even two sign-ins racing each other cannot create a second one.
 */
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_single_owner_idx").on(t.role).where(sql`"role" = 'owner'`)],
);

/** One signed-in device. Looked up on every request, so removal is immediate. */
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

/** A sign-in method linked to a user, such as their Google account. */
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

/** Short-lived values the library needs mid sign-in (OAuth state and the like). */
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/**
 * A passkey (Face ID, fingerprint, a security key) a member added to their
 * account, for @better-auth/passkey. Property names are the plugin's own
 * (note `credentialID`). A passkey only ever belongs to an existing user: the
 * plugin is configured so that adding one needs a signed-in session, and it
 * never creates a user. Removing a member deletes the user row, and their
 * passkeys go with it (ON DELETE CASCADE), so a removed member's passkey finds
 * nothing to sign in to.
 *
 * A passkey is bound to the site's domain (the relying-party id; see
 * passkeyRelyingParty() in src/lib/auth.ts). Moving the app to another domain
 * leaves these rows unusable, and members sign in with Google instead.
 */
export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    aaguid: text("aaguid"),
  },
  (t) => [
    index("passkey_user_id_idx").on(t.userId),
    uniqueIndex("passkey_credential_id_idx").on(t.credentialID),
  ],
);

/* -------------------------------------------------------------------------
 * The family (see src/lib/family.ts for the rules)
 * ---------------------------------------------------------------------- */

/** The family's name. There is exactly one family, so at most one row (id 1). */
export const family = pgTable(
  "family",
  {
    id: integer("id").primaryKey().default(1),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("family_single_row", sql`${t.id} = 1`)],
);

export const invitationStateEnum = pgEnum("invitation_state", [
  "pending",
  "accepted",
  "cancelled",
]);
export const invitationStates = invitationStateEnum.enumValues;

/**
 * The owner letting someone in. `name` only labels the pending invitation;
 * the member's display name comes from their Google profile. Emails are stored
 * lower-case, and an email has at most one pending invitation at a time.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    state: invitationStateEnum("state").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_pending_email_idx").on(t.email).where(sql`"state" = 'pending'`),
    check("invitations_email_lower_case", sql`${t.email} = lower(${t.email})`),
  ],
);

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Passkey = typeof passkey.$inferSelect;
export type Role = (typeof userRoles)[number];
export type Family = typeof family.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type InvitationState = (typeof invitationStates)[number];
