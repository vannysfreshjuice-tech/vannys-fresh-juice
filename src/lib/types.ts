// Every record type the app keeps. Figures such as "in the fridge", "in stock", "paid", "balance",
// "cost per litre" or "wages due" are NOT stored: they are always worked out from the records
// (see juice.ts, money rules in orders.ts, staff.ts).

export interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/** A bottle size, kept in Settings: its price, its premium price and what the bottle, cap and label cost. */
export interface Size {
  key: string; // '300', '500', '1000', '5000'
  label: string; // '300 ml'
  litres: number;
  price: number;
  premiumPrice: number;
  packCost: number;
  /** The packaging item (in Stock) that one bottle of this size uses up */
  bottleItemId?: string;
}

export type ProductKind = 'single' | 'cocktail';

export interface RecipeLine {
  itemId: string;
  qty: number; // for 10 litres
}

/** A juice or juice cocktail Vanny's sells. */
export interface Product extends Base {
  name: string;
  kind: ProductKind;
  icon: string; // an emoji
  colour: string; // '#FFA41B'
  premium: boolean;
  /** What goes into 10 litres */
  recipe: RecipeLine[];
  water: number; // litres per 10 litres
  keepsDays: number;
  /** Short list of what is in it, shown under a cocktail's name */
  tag?: string;
  archived?: boolean;
}

export type ItemKind = 'fruit' | 'packaging';

/** Fruit, sugar, ginger... or bottles, caps, labels. */
export interface StockItem extends Base {
  name: string;
  kind: ItemKind;
  unit: string;
  reorderLevel: number;
  archived?: boolean;
}

export interface Supplier extends Base {
  name: string;
  phone?: string;
  supplies?: string;
  archived?: boolean;
}

export const QUALITIES = ['Good', 'Fair', 'Poor'] as const;

export interface Purchase extends Base {
  date: string;
  supplierId?: string;
  supplierName: string;
  itemId: string;
  qty: number;
  price: number; // each unit
  quality?: string;
  note?: string;
}

/** A correction after counting stock (+ found, - thrown away / lost). */
export interface StockCount extends Base {
  date: string;
  itemId: string;
  qty: number;
  reason: string;
}

export interface Batch extends Base {
  number: string; // B-0001
  date: string;
  productId: string;
  litres: number; // juice made
  /** What really went in */
  used: RecipeLine[];
  /** Bottles filled, by size key. Empty while the batch is still being made. */
  filled: Record<string, number>;
  madeBy: string;
  bestBefore: string;
  checks: string[];
  note?: string;
}

/** Bottles taken out of the fridge for a sale or an order, and which batch they came from. */
export interface BottleLine {
  productId: string;
  size: string;
  qty: number;
  price: number; // each
  batchId?: string;
}

export interface Sale extends Base {
  number: string; // S-0001
  date: string;
  time: string;
  customerId?: string;
  customerName: string;
  lines: BottleLine[];
  method: string; // how it was paid, or 'On credit'
  emptiesBack?: number;
  note?: string;
}

export const ORDER_STAGES = ['To make', 'Ready', 'Out for delivery', 'Delivered', 'Cancelled'] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export interface OrderLine {
  productId: string;
  size: string;
  qty: number;
  price: number;
}

export interface Order extends Base {
  number: string; // VJ-0001
  customerId: string;
  date: string;
  dueDate: string;
  dueTime?: string;
  rider?: string;
  place?: string;
  lines: OrderLine[];
  deliveryFee?: number;
  stage: OrderStage;
  /** The day it was marked Delivered (counts as sold that day) */
  deliveredOn?: string;
  /** Filled when the order is marked Ready: the bottles taken out of the fridge for it */
  packed?: BottleLine[];
  notes?: string;
}

export type PaymentKind = 'order' | 'sale' | 'purchase';

export interface Payment extends Base {
  kind: PaymentKind;
  refId: string;
  amount: number;
  date: string;
  method: string;
  note?: string;
}

export const CUSTOMER_TYPES = ['Shop', 'School', 'Office', 'Events', 'Canteen', 'Hotel', 'Person', 'Other'] as const;

export interface Customer extends Base {
  name: string;
  type: string;
  phone?: string;
  place?: string;
  notes?: string;
  archived?: boolean;
}

export const WRITE_OFF_REASONS = ['Past best-before', 'Went sour', 'Bottle broke or leaked', 'Given away (samples)', 'Other'] as const;

export interface WriteOff extends Base {
  date: string;
  batchId: string;
  size: string;
  qty: number;
  reason: string;
}

export interface Expense extends Base {
  date: string;
  category: string;
  description: string;
  amount: number;
  method: string;
  note?: string;
}

export const ROLES = ['owner', 'production', 'sales', 'rider'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_NAMES: Record<Role, string> = { owner: 'Owner', production: 'Production', sales: 'Sales (counter)', rider: 'Rider' };

export interface Staff extends Base {
  name: string;
  role: Role;
  job: string; // 'Juice maker'
  payKind: 'day' | 'month' | 'none';
  rate: number;
  phone?: string;
  archived?: boolean;
  /** Cloud only: the person's own sign-in, given by the owner (Staff > person > Give a PIN) */
  loginUid?: string;
  /** Cloud only: the phone number (256...) they sign in with */
  loginPhone?: string;
}

/** One person, one day. id = `${date}_${staffId}` so a day can only be marked once. */
export interface Attendance extends Base {
  date: string;
  staffId: string;
  present: boolean;
}

export interface WagePayment extends Base {
  date: string;
  staffId: string;
  kind: 'wage' | 'advance';
  amount: number;
  method: string;
  note?: string;
}

export type Repeat = '' | 'daily' | 'weekly';
export type ReminderWay = 'calendar' | 'whatsapp';

export interface Reminder extends Base {
  date: string;
  time: string; // 'HH:MM'
  what: string;
  staffId?: string;
  orderId?: string;
  repeat: Repeat;
  ways: ReminderWay[];
  done?: boolean;
}

export interface FridgeReading extends Base {
  date: string;
  time: string;
  fridge: string;
  celsius: number;
  by?: string;
}

export interface Settings {
  businessName: string;
  whatsapp: string;
  phone: string;
  receiptNote: string;
  merchantCode: string;
  currency: string;
  methods: string[];
  expenseGroups: string[];
  sizes: Size[];
  /** Packaging every bottle uses once, whatever its size (caps, labels) */
  perBottle: string[];
  fridges: string[];
  fridgeMax: number;
  hygieneChecks: string[];
  bottleDeposit: number;
}

export const DEFAULT_SIZES: Size[] = [
  { key: '300', label: '300 ml', litres: 0.3, price: 2000, premiumPrice: 2500, packCost: 300 },
  { key: '500', label: '500 ml', litres: 0.5, price: 3000, premiumPrice: 4000, packCost: 400 },
  { key: '1000', label: '1 litre', litres: 1, price: 5500, premiumPrice: 7000, packCost: 650 },
  { key: '5000', label: '5 litre', litres: 5, price: 25000, premiumPrice: 30000, packCost: 2500 },
];

export const DEFAULT_SETTINGS: Settings = {
  businessName: "Vanny's Fresh Juice",
  whatsapp: '+256 785 965536',
  phone: '+256 751 349633',
  receiptNote: 'Thank you! Fresh every day.',
  merchantCode: '',
  currency: 'UGX',
  methods: ['Cash', 'MTN MoMo', 'Airtel Money', 'Bank'],
  expenseGroups: ['Rent', 'Power and water', 'Gas and fuel', 'Transport', 'Repairs', 'Cleaning', 'Market and licences', 'Other'],
  sizes: DEFAULT_SIZES,
  perBottle: [],
  fridges: ['Fridge 1', 'Fridge 2'],
  fridgeMax: 5,
  hygieneChecks: ['Hands washed, hairnet and apron on', 'Fruit washed in clean water', 'Blender, strainer and jugs sanitised', 'Bottles rinsed and dried', 'Fridge at 0 to 5 °C'],
  bottleDeposit: 500,
};

/** Collections kept in the store. 'settings' holds one record with id 'main'. */
export const COLLECTIONS = [
  'products',
  'items',
  'suppliers',
  'purchases',
  'counts',
  'batches',
  'sales',
  'orders',
  'payments',
  'customers',
  'writeOffs',
  'expenses',
  'staff',
  'attendance',
  'wages',
  'reminders',
  'readings',
  'settings',
] as const;
export type Col = (typeof COLLECTIONS)[number];

export interface Records {
  products: Product[];
  items: StockItem[];
  suppliers: Supplier[];
  purchases: Purchase[];
  counts: StockCount[];
  batches: Batch[];
  sales: Sale[];
  orders: Order[];
  payments: Payment[];
  customers: Customer[];
  writeOffs: WriteOff[];
  expenses: Expense[];
  staff: Staff[];
  attendance: Attendance[];
  wages: WagePayment[];
  reminders: Reminder[];
  readings: FridgeReading[];
}

export const RECORD_COLS = COLLECTIONS.filter((c) => c !== 'settings') as Exclude<Col, 'settings'>[];

export const EMPTY_RECORDS: Records = Object.fromEntries(RECORD_COLS.map((c) => [c, []])) as unknown as Records;
