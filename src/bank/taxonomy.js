/**
 * Transaction taxonomy for digital bank statements.
 * True revenue is every credit except internal transfers, loan proceeds
 * (MCA funding, cash advances, line-of-credit draws), and reversals of those payments.
 */

const FUNDERS = [
  ['paypal working capital', 'PayPal Working Capital'],
  ['forward financing', 'Forward Financing'],
  ['yellowstone capital', 'Yellowstone Capital'],
  ['national funding', 'National Funding'],
  ['reliance financial', 'Reliance Financial'],
  ['velocity capital', 'Velocity Capital'],
  ['mulligan funding', 'Mulligan Funding'],
  ['specialty capital', 'Specialty Capital'],
  ['everest business', 'Everest Business Funding'],
  ['headway capital', 'Headway Capital'],
  ['breakout capital', 'Breakout Capital'],
  ['shopify capital', 'Shopify Capital'],
  ['square capital', 'Square Capital'],
  ['stripe capital', 'Stripe Capital'],
  ['amazon lending', 'Amazon Lending'],
  ['pearl capital', 'Pearl Capital'],
  ['mantis funding', 'Mantis Funding'],
  ['rapid finance', 'Rapid Finance'],
  ['rapid advance', 'Rapid Advance'],
  ['newco capital', 'Newco Capital'],
  ['fora financial', 'Fora Financial'],
  ['cfg merchant', 'CFG Merchant'],
  ['elevate funding', 'Elevate Funding'],
  ['wellen capital', 'Wellen Capital'],
  ['celtic capital', 'Celtic Capital'],
  ['balboa capital', 'Balboa Capital'],
  ['idea financial', 'Idea Financial'],
  ['ebf holdings', 'EBF Holdings'],
  ['fox capital', 'Fox Capital'],
  ['can capital', 'CAN Capital'],
  ['last chance funding', 'Last Chance Funding'],
  ['unique funding', 'Unique Funding'],
  ['queen funding', 'Queen Funding'],
  ['channel partners', 'Channel Partners'],
  ['biz2credit', 'Biz2Credit'],
  ['fundation', 'Fundation'],
  ['cloudfund', 'CloudFund'],
  ['bluevine', 'BlueVine'],
  ['credibly', 'Credibly'],
  ['kapitus', 'Kapitus'],
  ['fundbox', 'Fundbox'],
  ['clearco', 'Clearco'],
  ['kabbage', 'Kabbage'],
  ['libertas', 'Libertas'],
  ['lendini', 'Lendini'],
  ['greenbox', 'Greenbox'],
  ['ondeck', 'OnDeck'],
  ['on deck', 'OnDeck'],
  ['itria', 'Itria'],
  ['lendio', 'Lendio'],
];

function rule(id, group, label, test) {
  return { id, group, label, test };
}

export const RULES = [
  rule('nsf_fee', 'fee', 'NSF fee', (d) => /nsf fee|insufficient funds fee|nsf charge|non-?sufficient funds/.test(d)),
  rule('overdraft_fee', 'fee', 'Overdraft fee', (d) => /overdraft fee|od fee|overdraft charge|courtesy pay fee/.test(d)),
  rule('returned_item_fee', 'fee', 'Returned item fee', (d) => /returned item fee|return item fee|returned check fee|bounced check fee/.test(d)),
  rule('wire_fee', 'fee', 'Wire fee', (d) => /wire fee|wire transfer fee|incoming wire fee|outgoing wire fee/.test(d)),
  rule('atm_fee', 'fee', 'ATM fee', (d) => /atm fee|atm surcharge|non-?network atm fee/.test(d)),
  rule('monthly_maintenance_fee', 'fee', 'Monthly maintenance fee', (d) => /monthly (maintenance|service) fee|account maintenance fee/.test(d)),
  rule('stop_payment_fee', 'fee', 'Stop payment fee', (d) => /stop payment fee/.test(d)),
  rule('foreign_transaction_fee', 'fee', 'Foreign transaction fee', (d) => /foreign transaction fee|\bfx fee\b|international service fee/.test(d)),
  rule('merchant_processing_fee', 'fee', 'Merchant processing fee', (d) => /merchant (service |processing )?fee|interchange fee|batch fee/.test(d)),
  rule('bank_service_fee', 'fee', 'Bank service fee', (d) => /\b(service charge|service fee|bank fee|analysis fee|paper statement fee|dormant fee)\b/.test(d)),
  rule('sba_loan_payment', 'financing_out', 'SBA loan payment', (d, a) => a < 0 && /\bsba\b/.test(d)),
  rule('loan_payment_reversal', 'financing_in', 'Loan payment reversal', (d, a) => a > 0 && /\bloan\b/.test(d) && /return|revers|reject|bounce|unpaid/.test(d)),
  rule('loan_proceeds', 'financing_in', 'Loan proceeds', (d, a) => a > 0 && /\b(loan proceeds|proceeds of loan|term loan|loan funding|loan deposit|sba loan)\b/.test(d)),
  rule('loan_payment', 'financing_out', 'Loan payment', (d, a) => a < 0 && /\b(loan payment|loan pmt|loan pymt|installment loan|auto loan|mortgage payment)\b/.test(d)),
  rule('mca_payment_reversal', 'financing_in', 'MCA payment reversal', (d, a) => a > 0 && /merchant cash advance|\bmca\b/.test(d) && /return|revers|reject|bounce|unpaid/.test(d)),
  rule('mca_proceeds', 'financing_in', 'MCA proceeds', (d, a) => a > 0 && /merchant cash advance|\bmca (funding|proceeds|deposit)\b/.test(d)),
  rule('mca_payment', 'financing_out', 'MCA payment', (d, a) => a < 0 && /merchant cash advance|\bmca (payment|debit|ach)\b/.test(d)),
  rule('equipment_lease', 'financing_out', 'Equipment lease', (d, a) => a < 0 && /\b(equipment lease|lease payment|leaf commercial|marlin lease)\b/.test(d)),
  rule('credit_card_advance', 'financing_in', 'Credit card cash advance', (d, a) => a > 0 && /cash advance|credit card advance/.test(d)),
  rule('line_of_credit_draw', 'financing_in', 'Line of credit draw', (d, a) => a > 0 && /line of credit (advance|draw)|loc advance|heloc advance/.test(d)),
  rule('line_of_credit_payment', 'financing_out', 'Line of credit payment', (d, a) => a < 0 && /line of credit (payment|pmt)|loc payment|heloc payment/.test(d)),
  rule('credit_card_payment', 'financing_out', 'Credit card payment', (d, a) => a < 0 && /\b(credit card payment|cr card pmt|amex (epayment|payment)|visa payment|mastercard payment|discover payment)\b/.test(d)),
  rule('overdraft_protection_in', 'transfer', 'Overdraft protection transfer', (d, a) => a > 0 && /overdraft protection|od protection transfer/.test(d)),
  rule('savings_transfer_in', 'transfer', 'Savings transfer in', (d, a) => a > 0 && /savings transfer in|transfer from sav/.test(d)),
  rule('savings_transfer_out', 'transfer', 'Savings transfer out', (d, a) => a < 0 && /savings transfer out|transfer to sav/.test(d)),
  rule('internal_transfer_in', 'transfer', 'Internal transfer in', (d, a) => a > 0 && /transfer from (sav|checking|chk|share|acct|account)|from savings|from checking|internal transfer|xfer from|online transfer from/.test(d)),
  rule('internal_transfer_out', 'transfer', 'Internal transfer out', (d, a) => a < 0 && /transfer to (sav|checking|chk|share|acct|account)|to savings|to checking|internal transfer|xfer to|online transfer to/.test(d)),
  rule('brokerage_transfer_in', 'transfer', 'Brokerage transfer in', (d, a) => a > 0 && /(brokerage transfer|from (etrade|e\*trade|fidelity|schwab|vanguard|robinhood))/.test(d)),
  rule('brokerage_transfer_out', 'transfer', 'Brokerage transfer out', (d, a) => a < 0 && /(brokerage transfer|to (etrade|e\*trade|fidelity|schwab|vanguard|robinhood))/.test(d)),
  rule('investment_purchase', 'transfer', 'Investment purchase', (d, a) => a < 0 && /investment purchase|brokerage purchase|buy (shares|stock)/.test(d)),
  rule('investment_redemption', 'non_operating_income', 'Investment redemption', (d, a) => a > 0 && /investment redemption|stock sale proceeds/.test(d)),
  rule('owner_contribution', 'owner', 'Owner contribution', (d, a) => a > 0 && /owner (contribution|deposit|equity)|capital contribution|shareholder deposit/.test(d)),
  rule('owner_draw', 'owner', 'Owner draw', (d, a) => a < 0 && /owner (draw|distribution|withdrawal)|shareholder distribution|member distribution/.test(d)),
  rule('payroll_tax', 'tax', 'Payroll tax', (d, a) => a < 0 && /eftps|payroll tax|\b941\b|withholding tax|state wh tax/.test(d)),
  rule('income_tax_payment', 'tax', 'Income tax payment', (d, a) => a < 0 && /irs usataxpy|usatax|estimated tax|income tax|franchise tax payment/.test(d)),
  rule('sales_tax_payment', 'tax', 'Sales tax payment', (d, a) => a < 0 && /sales tax|dept of revenue|state tax payment/.test(d)),
  rule('payroll_wages', 'operating_expense', 'Payroll wages', (d, a) => a < 0 && /\b(adp|gusto|paychex|rippling|payroll|payrol|wages|salary)\b/.test(d)),
  rule('contractor_payment', 'operating_expense', 'Contractor payment', (d, a) => a < 0 && /\b(contractor|1099|upwork|fiverr)\b/.test(d)),
  rule('card_batch_deposit', 'revenue', 'Card batch deposit', (d, a) => a > 0 && /stripe|square (?!capital)|shopify (?!capital)|\bclover\b|\btoast\b|heartland|\btsys\b|worldpay|merchant (deposit|batch|services)|pos deposit|card batch/.test(d)),
  rule('marketplace_payout', 'revenue', 'Marketplace payout', (d, a) => a > 0 && /amazon (services|marketplace|payout)|amzn mktp|\bebay\b|\betsy\b|walmart marketplace/.test(d)),
  rule('mobile_deposit', 'revenue', 'Mobile deposit', (d, a) => a > 0 && /mobile deposit|remote deposit|mobi?le ck/.test(d)),
  rule('atm_deposit', 'revenue', 'ATM deposit', (d, a) => a > 0 && /atm deposit|atm cash deposit/.test(d)),
  rule('cash_deposit', 'revenue', 'Cash deposit', (d, a) => a > 0 && /cash deposit|counter deposit|branch deposit|deposit cash/.test(d)),
  rule('check_deposit', 'revenue', 'Check deposit', (d, a) => a > 0 && /check deposit|chk deposit|deposit check/.test(d)),
  rule('pos_sales', 'revenue', 'Point of sale sales', (d, a) => a > 0 && /\bpos (credit|deposit|sales)\b|point of sale/.test(d)),
  rule('invoice_payment', 'revenue', 'Invoice payment', (d, a) => a > 0 && /invoice payment|payment for invoice|inv pmt/.test(d)),
  rule('recurring_customer_payment', 'revenue', 'Recurring customer payment', (d, a) => a > 0 && /recurring (payment|deposit)|subscription payment from/.test(d)),
  rule('wire_customer_payment', 'revenue', 'Wire from a customer', (d, a) => a > 0 && /incoming wire|wire (in|credit|transfer from)|wire received/.test(d) && !/fee/.test(d)),
  rule('ach_customer_payment', 'revenue', 'ACH customer payment', (d, a) => a > 0 && /ach credit|ach deposit|ppd credit/.test(d)),
  rule('zelle_in', 'revenue', 'Zelle received', (d, a) => a > 0 && /\bzelle\b/.test(d)),
  rule('venmo_in', 'revenue', 'Venmo received', (d, a) => a > 0 && /\bvenmo\b/.test(d)),
  rule('cash_app_in', 'revenue', 'Cash App received', (d, a) => a > 0 && /cash app|\bcashapp\b/.test(d)),
  rule('paypal_in', 'revenue', 'PayPal received', (d, a) => a > 0 && /\bpaypal\b/.test(d)),
  rule('interest_income', 'non_operating_income', 'Interest income', (d, a) => a > 0 && /interest (paid|credit|earned|payment)/.test(d)),
  rule('dividend_income', 'non_operating_income', 'Dividend income', (d, a) => a > 0 && /\bdividend\b/.test(d)),
  rule('tax_refund', 'non_operating_income', 'Tax refund', (d, a) => a > 0 && /tax refund|irs treas|tax ref/.test(d)),
  rule('insurance_claim', 'non_operating_income', 'Insurance claim', (d, a) => a > 0 && /insurance claim|claim payment/.test(d)),
  rule('chargeback_reversal', 'non_operating_income', 'Chargeback reversal', (d, a) => a > 0 && /chargeback reversal|representment/.test(d)),
  rule('refund_received', 'non_operating_income', 'Refund received', (d, a) => a > 0 && /\brefund\b/.test(d)),
  rule('reward_bonus', 'non_operating_income', 'Reward or bonus credit', (d, a) => a > 0 && /cash back|reward credit|bonus credit/.test(d)),
  rule('rent', 'operating_expense', 'Rent', (d, a) => a < 0 && /\brent\b|wework|extra space storage/.test(d)),
  rule('utilities_electric', 'operating_expense', 'Electric utility', (d, a) => a < 0 && /electric|pg&e|\bpge\b|con edison|duke energy|power & light|florida power/.test(d)),
  rule('utilities_gas', 'operating_expense', 'Gas utility', (d, a) => a < 0 && /gas company|natural gas|\bnicor\b|southern gas/.test(d)),
  rule('utilities_water', 'operating_expense', 'Water utility', (d, a) => a < 0 && /water (bill|utility|dept)|sewer|waste management/.test(d)),
  rule('internet_phone', 'operating_expense', 'Internet and phone', (d, a) => a < 0 && /comcast|xfinity|verizon|at&t|\bt-mobile\b|spectrum|cox comm|internet service/.test(d)),
  rule('insurance_premium', 'operating_expense', 'Insurance premium', (d, a) => a < 0 && /\binsurance\b|geico|progressive|state farm|allstate/.test(d)),
  rule('software_saas', 'operating_expense', 'Software subscription', (d, a) => a < 0 && /adobe|microsoft|google workspace|\bslack\b|\bzoom\b|dropbox|quickbooks|intuit|\baws\b|github|shopify subscription/.test(d)),
  rule('advertising', 'operating_expense', 'Advertising', (d, a) => a < 0 && /facebook ads|google ads|meta ads|\badvertis|yelp ads|tiktok ads/.test(d)),
  rule('shipping_postage', 'operating_expense', 'Shipping and postage', (d, a) => a < 0 && /\busps\b|\bups\b|\bfedex\b|\bdhl\b|stamps\.com|postage|shipping/.test(d)),
  rule('inventory_cogs', 'operating_expense', 'Inventory and supplies for resale', (d, a) => a < 0 && /\bsysco\b|us foods|restaurant depot|\bcostco\b|inventory purchase/.test(d)),
  rule('office_supplies', 'operating_expense', 'Office supplies', (d, a) => a < 0 && /staples|office depot|office supplies|uline/.test(d)),
  rule('legal_fees', 'operating_expense', 'Legal fees', (d, a) => a < 0 && /legal fee|law firm|attorney|lawyer/.test(d)),
  rule('accounting_fees', 'operating_expense', 'Accounting fees', (d, a) => a < 0 && /accounting|bookkeep|cpa fee/.test(d)),
  rule('professional_services', 'operating_expense', 'Professional services', (d, a) => a < 0 && /consulting fee|professional service|freelancer/.test(d)),
  rule('fuel', 'operating_expense', 'Fuel', (d, a) => a < 0 && /\b(shell|chevron|exxon|mobil|bp |sunoco|fuel|gas station)\b/.test(d)),
  rule('meals', 'operating_expense', 'Meals', (d, a) => a < 0 && /doordash|uber eats|ubereats|grubhub|restaurant|starbucks/.test(d)),
  rule('lodging', 'operating_expense', 'Lodging', (d, a) => a < 0 && /\b(hotel|airbnb|marriott|hilton|hyatt)\b/.test(d)),
  rule('travel', 'operating_expense', 'Travel', (d, a) => a < 0 && /airline|\bdelta\b|united air|southwest air|\buber trip\b|\blyft\b|amtrak/.test(d)),
  rule('vehicle_expense', 'operating_expense', 'Vehicle expense', (d, a) => a < 0 && /auto repair|vehicle expense|car wash|parking|toll /.test(d)),
  rule('repairs_maintenance', 'operating_expense', 'Repairs and maintenance', (d, a) => a < 0 && /repair|maintenance|home depot|lowes|lowe's/.test(d)),
  rule('healthcare', 'operating_expense', 'Healthcare', (d, a) => a < 0 && /pharmacy|medical|dental|clinic|hospital|cvs\/pharmacy/.test(d)),
  rule('education', 'operating_expense', 'Education', (d, a) => a < 0 && /tuition|university|training course|udemy/.test(d)),
  rule('charitable_donation', 'operating_expense', 'Charitable donation', (d, a) => a < 0 && /donation|charity|church tithe/.test(d)),
  rule('government_fee', 'operating_expense', 'Government fee', (d, a) => a < 0 && /secretary of state|business license|permit fee|dmv /.test(d)),
  rule('subscription', 'operating_expense', 'Subscription', (d, a) => a < 0 && /\bsubscription\b|\bnetflix\b|\bspotify\b/.test(d)),
  rule('interest_expense', 'operating_expense', 'Interest expense', (d, a) => a < 0 && /interest charge|interest expense|finance charge/.test(d)),
  rule('gambling', 'operating_expense', 'Gambling', (d, a) => a < 0 && /casino|draftkings|fanduel|lottery/.test(d)),
  rule('crypto_purchase', 'operating_expense', 'Crypto purchase', (d, a) => a < 0 && /coinbase|binance|crypto\.com|bitcoin/.test(d)),
  rule('debt_collection', 'operating_expense', 'Debt collection', (d, a) => a < 0 && /collection agency|debt collector|recovery agency/.test(d)),
  rule('chargeback', 'operating_expense', 'Chargeback', (d, a) => a < 0 && /chargeback/.test(d)),
  rule('returned_deposit', 'operating_expense', 'Returned deposit', (d, a) => a < 0 && /returned deposit|deposit returned|returned ck/.test(d)),
  rule('remote_deposit_return', 'operating_expense', 'Remote deposit return', (d, a) => a < 0 && /remote deposit return|mobile deposit return/.test(d)),
  rule('atm_withdrawal', 'operating_expense', 'ATM withdrawal', (d, a) => a < 0 && /atm withdrawal|atm w\/d|cash withdrawal/.test(d)),
  rule('check_paid', 'operating_expense', 'Check paid', (d, a) => a < 0 && (/\bcheck\s*#?\s*\d+/.test(d) || /\bchk\s*#?\s*\d+/.test(d) || /^check\b/.test(d)) && !/deposit|fee/.test(d)),
  rule('zelle_out', 'operating_expense', 'Zelle sent', (d, a) => a < 0 && /\bzelle\b/.test(d)),
  rule('venmo_out', 'operating_expense', 'Venmo sent', (d, a) => a < 0 && /\bvenmo\b/.test(d)),
  rule('cash_app_out', 'operating_expense', 'Cash App sent', (d, a) => a < 0 && /cash app|\bcashapp\b/.test(d)),
  rule('card_purchase', 'operating_expense', 'Card purchase', (d, a) => a < 0 && /pos purchase|debit card|visa |mastercard|point of sale purchase|sq \*/.test(d)),
  rule('wire_out', 'operating_expense', 'Wire sent', (d, a) => a < 0 && /outgoing wire|wire out|wire transfer to|domestic wire/.test(d) && !/fee/.test(d)),
  rule('ach_debit', 'operating_expense', 'ACH debit', (d, a) => a < 0 && /ach debit|ach payment|ppd debit|ccd debit/.test(d)),
];

export const TAXONOMY = [
  ...RULES.map(({ id, group, label }) => ({ id, group, label })),
  { id: 'other_credit', group: 'other', label: 'Other credit' },
  { id: 'other_debit', group: 'other', label: 'Other debit' },
];

const BY_ID = new Map(TAXONOMY.map((t) => [t.id, t]));

const TRANSFER_IN = new Set([
  'internal_transfer_in',
  'savings_transfer_in',
  'overdraft_protection_in',
  'brokerage_transfer_in',
]);

const LOAN_IN = new Set([
  'loan_proceeds',
  'mca_proceeds',
  'credit_card_advance',
  'line_of_credit_draw',
]);

const REVERSAL_IN = new Set([
  'mca_payment_reversal',
  'loan_payment_reversal',
]);

export function matchFunder(text) {
  const d = String(text || '').toLowerCase();
  for (const [needle, name] of FUNDERS) {
    if (d.includes(needle)) return { key: needle, name };
  }
  return null;
}

export function categoryGroup(id) {
  return BY_ID.get(id)?.group ?? 'other';
}

export function categorize(description, amount) {
  const d = String(description || '').toLowerCase().replace(/\s+/g, ' ');
  const funder = matchFunder(d);
  const smallFee = amount < 0 && /\bfee\b/.test(d) && Math.abs(amount) <= 80;
  if (funder && !smallFee) {
    if (amount > 0 && /return|revers|reject|bounce|unpaid/.test(d)) {
      return { category: 'mca_payment_reversal', category_group: 'financing_in', funder };
    }
    if (amount > 0) return { category: 'mca_proceeds', category_group: 'financing_in', funder };
    if (amount < 0) return { category: 'mca_payment', category_group: 'financing_out', funder };
  }
  for (const entry of RULES) {
    if (entry.test(d, amount)) {
      return { category: entry.id, category_group: entry.group, funder: funder && smallFee ? funder : null };
    }
  }
  const category = amount >= 0 ? 'other_credit' : 'other_debit';
  return { category, category_group: 'other', funder: null };
}

/** How a credit is treated for true revenue. Debits never count. */
export function trueRevenueTreatment(category, amount) {
  if (!(amount > 0)) return { counts: false, bucket: null };
  if (TRANSFER_IN.has(category)) return { counts: false, bucket: 'internal_transfers' };
  if (LOAN_IN.has(category)) return { counts: false, bucket: 'loan_proceeds' };
  if (REVERSAL_IN.has(category)) return { counts: false, bucket: 'financing_reversals' };
  return { counts: true, bucket: null };
}

export const TRUE_REVENUE_DEFINITION = 'Credits excluding internal transfers, loan proceeds (including MCA funding, cash advances, and line-of-credit draws), and reversals of loan or MCA payments.';
