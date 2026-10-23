import { VAWC_TYPES } from './vawcTypes';

/**
 * What each case category means, and how seriously it starts out.
 *
 * This is editorial: the description and the risk bias are the office's own
 * guidance on how a category is handled, and they belong in code. The counts
 * beside them do not - those come from the barangay's filings. The page that
 * shows this used to carry a hard-coded distribution (142 thefts, 98
 * nuisances, and an invented percentage trend per row) that no officer had
 * ever filed. None of that is here.
 */
export interface CategoryMeta {
  category: string;
  code: string;
  color: string;
  riskBias: 'Critical' | 'High' | 'Medium' | 'Low';
  description: string;
}

export const BLOTTER_CATEGORIES: CategoryMeta[] = [
  { category: 'Theft & Robbery', code: 'TRB', color: '#14b8a6', riskBias: 'High',
    description: 'Larceny, burglary, robbery and motor vehicle theft' },
  { category: 'Public Nuisance', code: 'PNS', color: '#3b82f6', riskBias: 'Medium',
    description: 'Noise complaints, illegal dumping, obstruction of public areas' },
  { category: 'Domestic Dispute', code: 'DDS', color: '#f97316', riskBias: 'High',
    description: 'Family conflict and household disputes with no abuse alleged' },
  { category: 'Assault', code: 'AST', color: '#ef4444', riskBias: 'Critical',
    description: 'Physical altercations, threats and battery' },
  { category: 'Cybercrime', code: 'CYB', color: '#8b5cf6', riskBias: 'High',
    description: 'Online fraud, identity theft, cyberbullying, data breaches' },
  { category: 'Vandalism', code: 'VAN', color: '#f59e0b', riskBias: 'Low',
    description: 'Property damage, graffiti, destruction of public property' },
  { category: 'Drug-Related', code: 'DRG', color: '#ec4899', riskBias: 'Critical',
    description: 'Possession, distribution and paraphernalia' },
  { category: 'Noise Complaint', code: 'NSE', color: '#0ea5e9', riskBias: 'Low',
    description: 'Sustained noise disturbing a household or a street' },
  { category: 'Trespassing', code: 'TRS', color: '#84cc16', riskBias: 'Medium',
    description: 'Entering or remaining on property without permission' },
  { category: 'Infrastructure Issue', code: 'INF', color: '#64748b', riskBias: 'Low',
    description: 'Roads, drainage, lighting and other barangay facilities' },
  { category: 'Other', code: 'OTH', color: '#94a3b8', riskBias: 'Medium',
    description: 'Anything the list above does not cover; read the report itself' },
];

/**
 * The VAWC desk's own categories, in the order of the office's list.
 *
 * Every one of them starts High or Critical. That is not a hedge: these are
 * the categories where under-reacting is the costly mistake, and the risk
 * engine may raise a case from here but the desk does not open one low.
 */
export const VAWC_CATEGORIES: CategoryMeta[] = [
  { category: 'Domestic Violence', code: 'DV', color: '#ef4444', riskBias: 'Critical',
    description: 'Abuse by a spouse, partner or former partner, in or out of the home' },
  { category: 'Physical Abuse', code: 'PHY', color: '#f43f5e', riskBias: 'Critical',
    description: 'Bodily harm inflicted on a woman or a child' },
  { category: 'Sexual Harassment', code: 'SH', color: '#f97316', riskBias: 'High',
    description: 'Unwanted sexual conduct, including at work or in public' },
  { category: 'Child Abuse', code: 'CA', color: '#8b5cf6', riskBias: 'Critical',
    description: 'Harm, neglect or exploitation of a minor' },
  { category: 'Stalking', code: 'STK', color: '#a855f7', riskBias: 'High',
    description: 'Repeated following, watching or contact that causes fear' },
  { category: 'Emotional Abuse', code: 'EMO', color: '#6366f1', riskBias: 'High',
    description: 'Intimidation, humiliation and controlling behaviour' },
  { category: 'Economic Abuse', code: 'ECO', color: '#0ea5e9', riskBias: 'High',
    description: 'Withholding money, property or the means to support oneself' },
  { category: 'Sexual Violence', code: 'SV', color: '#dc2626', riskBias: 'Critical',
    description: 'Rape and other sexual assault' },
  { category: 'Human Trafficking', code: 'HT', color: '#be123c', riskBias: 'Critical',
    description: 'Recruitment or transport of a person for exploitation' },
  { category: 'VAWC - Other', code: 'OTH', color: '#94a3b8', riskBias: 'High',
    description: 'A VAWC report the list above does not cover; read it in full' },
];

/** Guidance for a category, or a neutral entry so an unknown type still shows. */
export function metaFor(category: string, set: CategoryMeta[]): CategoryMeta {
  return set.find(c => c.category === category) ?? {
    category,
    code: category.slice(0, 3).toUpperCase(),
    color: '#94a3b8',
    riskBias: 'Medium',
    description: 'Not on the office’s category list; read the report itself.',
  };
}

export const VAWC_CATEGORY_NAMES: readonly string[] = VAWC_TYPES;
