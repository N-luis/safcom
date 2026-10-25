/**
 * The official intake form, transcribed from the source document
 * ("INTAKE FORM - CONFIDENTIAL", 5 pages; sections A-D, items 1-51).
 *
 * One definition, used by the form on screen and by the server's validation,
 * so what can be saved is exactly what the form can show. Item numbers,
 * wording, options and section order follow the document. Two things are
 * not from the document and are marked `proposed: true`: the safety check
 * asked before the interview, and the review step. Nothing here is a legal
 * determination.
 *
 * Client-safe: no data, no keys.
 */

export const INTAKE_FORM_VERSION = 'intake-form/2026-10 (source: intake form.pdf, 5 pp.)';

export type Marker = 'na' | 'unknown' | 'declined';
export const MARKER_LABEL: Record<Marker, string> = { na: 'N/A', unknown: 'Unknown', declined: 'Declined to answer' };

export interface Option { value: string; label: string; specify?: 'required' | 'optional'; specifyLabel?: string }
export interface OptionGroup { title: string; options: Option[] }

export type ItemType =
  | 'date' | 'time' | 'text' | 'textarea' | 'number'
  | 'name' | 'address' | 'place' | 'location'
  | 'single' | 'multi' | 'yesNoSpecify' | 'yesNoDetail' | 'confirm';

export interface Item {
  key: string;
  /** The document's item number, when it has one. */
  no?: string;
  label: string;
  hint?: string;
  type: ItemType;
  options?: Option[];
  groups?: OptionGroup[];
  /** name: which sub-fields. */
  parts?: { key: string; label: string }[];
  /** address: offer the document's "Homeless" box. */
  homeless?: boolean;
  /** yesNoSpecify / yesNoDetail: the "Yes" follow-up. */
  yesLabel?: string;
  detailOptions?: Option[];
  /** When the item is asked: always, only in some cases, or never needed for completion. */
  applies?: (r: Responses) => 'required' | 'optional' | 'hidden';
  /** Not in the source document. */
  proposed?: boolean;
}

export interface Section { key: string; title: string; note?: string; proposed?: boolean; items: Item[] }

/** One answer: a value, or why there is none. */
export interface Answer {
  value?: string | string[] | Record<string, string>;
  /** "Others, specify" text, keyed by option value. */
  specify?: Record<string, string>;
  /** address: the "Homeless" box. */
  homeless?: boolean;
  /** yesNoDetail: the follow-up choice. */
  detail?: string;
  marker?: Marker;
}
export type Responses = Record<string, Answer>;

const NAME_PARTS = [
  { key: 'last', label: 'Last Name' }, { key: 'first', label: 'First Name' },
  { key: 'middle', label: 'Middle Name' }, { key: 'extension', label: 'Extension' },
];
const NAME_ALIAS_PARTS = [...NAME_PARTS, { key: 'others', label: 'Others (alias, nickname, etc)' }];
export const ADDRESS_PARTS = [
  { key: 'houseNumber', label: 'House Number' }, { key: 'street', label: 'Street' }, { key: 'barangay', label: 'Barangay' },
  { key: 'city', label: 'City/Mun' }, { key: 'province', label: 'Province' }, { key: 'region', label: 'Region' },
];
const PLACE_PARTS = [{ key: 'city', label: 'City/Municipality' }, { key: 'province', label: 'Province' }, { key: 'region', label: 'Region' }];
const LOCATION_PARTS = [{ key: 'barangay', label: 'Barangay' }, { key: 'city', label: 'City/Mun' }, { key: 'province', label: 'Province' }];

const o = (value: string, label: string, specify?: 'required' | 'optional', specifyLabel?: string): Option => ({ value, label, specify, specifyLabel });

const RELIGION: Option[] = [
  o('roman_catholic', 'Roman Catholic'), o('islam', 'Islam'), o('evangelicals', 'Evangelicals'), o('protestant', 'Protestant'),
  o('iglesia_ni_cristo', 'Iglesia ni Cristo'), o('others', 'Others, specify', 'required'),
];
const NATIONALITY: Option[] = [o('filipino', 'Filipino'), o('non_filipino', 'Non-Filipino, specify', 'required')];

const age = (r: Responses, key: string) => {
  const v = r[key]?.value;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const isInformant = (r: Responses) => ['companion_present', 'informant_absent'].includes(String(r.reportingMode?.value ?? ''));
const inConflictOrCalamity = (r: Responses) => r.conflictArea?.value === 'yes' || r.calamityArea?.value === 'yes';

export const INTAKE_SECTIONS: Section[] = [
  {
    key: 'safety',
    title: 'Before the interview — safety and consent',
    proposed: true,
    note: 'Proposed addition, not in the source form. The form\'s instructions ask that the client be reminded that everything is kept confidential and that they may decline to answer any question.',
    items: [
      { key: 'safeToSpeak', label: 'Has the client confirmed they can speak safely and privately right now?', type: 'single', proposed: true,
        hint: 'The person responsible may have access to the client\'s phone or be nearby. If not safe, stop and arrange another time or channel.',
        options: [o('yes', 'Yes'), o('no', 'No - stop and arrange a safe time'), o('not_asked', 'Not yet asked')] },
      { key: 'confidentialityReminder', label: 'The client was reminded that all information is kept confidential and that they may decline to answer any question.',
        type: 'confirm', proposed: true },
      { key: 'immediateDanger', label: 'Did the client disclose that anyone is in immediate danger?', type: 'single', proposed: true,
        hint: 'If yes, follow the urgent-response workflow now - you do not need to finish this form first.',
        options: [o('yes', 'Yes'), o('no', 'No'), o('unknown', 'Not known')] },
      { key: 'safetyNotes', label: 'Safety notes (optional)', type: 'textarea', proposed: true, applies: () => 'optional' },
    ],
  },
  {
    key: 'A',
    title: 'A. Administrative Information',
    items: [
      { key: 'dateOfIntake', no: '1', label: 'Date of Intake/Interview', type: 'date' },
      { key: 'intakeBy', no: '2', label: 'Intake/Interview By', type: 'name', parts: NAME_PARTS },
      { key: 'positionTitle', no: '3', label: 'Position/Job Title', type: 'text' },
      { key: 'handlingOrganization', no: '4', label: 'Handling Organization', type: 'text' },
      { key: 'officeAddress', no: '5', label: 'Office Address', type: 'text' },
      { key: 'clientCode', no: '6', label: 'Client Code', type: 'text' },
      { key: 'incidentNo', no: '7', label: 'Incident No.', type: 'text' },
      { key: 'reportingMode', label: 'How it was reported', type: 'single', options: [
        o('victim_survivor', 'Reported by the victim-survivor (proceed to Section B. Victim-Survivor Information)'),
        o('companion_present', 'Reported by victim-survivor\'s companion and victim-survivor is present at reporting (proceed to items no. 8-10)'),
        o('informant_absent', 'Reported by informant and victim-survivor is not present at reporting (proceed to items no. 8-10)'),
      ] },
      { key: 'informantName', no: '8', label: 'Name of Informant', type: 'text', applies: r => isInformant(r) ? 'required' : 'hidden' },
      { key: 'informantRelationship', no: '9', label: 'Relationship to victim-survivor', type: 'text', applies: r => isInformant(r) ? 'required' : 'hidden' },
      { key: 'informantContact', no: '10', label: 'Contact Information', type: 'text', applies: r => isInformant(r) ? 'required' : 'hidden',
        hint: 'Record a contact the informant confirms is safe to use. The registered contact is in Section 1.' },
    ],
  },
  {
    key: 'B',
    title: 'B. Victim-Survivor Information',
    items: [
      { key: 'victimName', no: '11', label: 'Name', type: 'name', parts: NAME_ALIAS_PARTS },
      { key: 'sexAtBirth', no: '12', label: 'Sex assigned at birth', type: 'single', options: [o('male', 'Male'), o('female', 'Female'), o('intersex', 'Intersex')] },
      { key: 'diverseSogie', no: '13', label: 'Is the client a person with diverse SOGIE?', type: 'single',
        options: [o('no', 'No'), o('yes', 'Yes, specify (optional)', 'optional'), o('does_not_want_to_identify', 'Does not want to identify')] },
      { key: 'birthdate', no: '14', label: 'Birthdate', type: 'date' },
      { key: 'placeOfBirth', no: '15', label: 'Place of Birth', type: 'place', parts: PLACE_PARTS },
      { key: 'age', no: '16', label: 'Age', type: 'number' },
      { key: 'minorGuardian', no: '17', label: 'If the client is a minor, please indicate Name and Contact Info of Parent/Guardian', type: 'textarea',
        applies: r => { const a = age(r, 'age'); return a !== null && a < 18 ? 'required' : a === null ? 'optional' : 'hidden'; } },
      { key: 'childStatus', no: '17.a', label: 'If applicable, indicate if the child is:', type: 'single',
        options: [o('orphan', 'An orphan'), o('unaccompanied', 'Unaccompanied'), o('separated', 'Separated'), o('vulnerable', 'Vulnerable')],
        applies: r => { const a = age(r, 'age'); return a !== null && a < 18 ? 'required' : a === null ? 'optional' : 'hidden'; } },
      { key: 'civilStatus', no: '18', label: 'Current Civil Status', type: 'single', options: [
        o('single', 'Single'), o('legally_married', 'Legally married'), o('consensual', 'Consensual, common law, or live-in partner'),
        o('legally_separated', 'Legally separated'), o('separated_in_fact', 'Separated in fact'), o('widowed', 'Widowed'), o('annulled', 'Annulled'),
      ] },
      { key: 'education', no: '19', label: 'Educational Attainment', type: 'single', options: [
        o('none', 'No formal education'), o('elementary', 'Elementary level/ graduate'), o('junior_high', 'Junior high school level/ graduate'),
        o('senior_high', 'Senior high school level/ graduate'), o('technical', 'Technical/ vocational'), o('college', 'College level/ graduate'),
        o('post_graduate', 'Post graduate'),
      ] },
      { key: 'nationality', no: '20', label: 'Nationality', type: 'single', options: NATIONALITY },
      { key: 'ethnicity', no: '21', label: 'Ethnicity', type: 'text' },
      { key: 'occupation', no: '22', label: 'Main Occupation', type: 'text' },
      { key: 'monthlyIncome', no: '23', label: 'Monthly Income', type: 'text' },
      { key: 'employmentStatus', no: '24', label: 'Employment Status', type: 'single', options: [
        o('employed_public', 'Employed (Public)', 'required', 'Name and Address of Employer'),
        o('employed_private', 'Employed (Private)', 'required', 'Name and Address of Employer'),
        o('self_employed', 'Self-employed'), o('informal', 'Informal Sector'), o('unemployed', 'Unemployed'), o('not_applicable', 'Not applicable'),
      ] },
      { key: 'migratoryStatus', no: '25', label: 'Migratory Status', type: 'single', options: [
        o('current_ofw', 'Current OFW'), o('former_ofw', 'Former/Returning OFW'), o('seeking_abroad', 'Seeking employment abroad'), o('not_applicable', 'Not applicable'),
      ] },
      { key: 'religion', no: '26', label: 'Religion', type: 'single', options: RELIGION },
      { key: 'currentAddress', no: '27', label: 'Current Address', type: 'address', parts: ADDRESS_PARTS, homeless: true },
      { key: 'internallyDisplaced', no: '28', label: 'Is the client internally displaced?', type: 'single', options: [o('yes', 'Yes'), o('no', 'No')] },
      { key: 'pwd', no: '29', label: 'Is the client a person with disability (PWD)?', type: 'single', options: [
        o('no', 'No'), o('deaf', 'Yes - Deaf or Hard of Hearing'), o('intellectual', 'Yes - Intellectual Disability'),
        o('learning', 'Yes - Learning Disability'), o('mental', 'Yes - Mental Disability'), o('orthopedic', 'Yes - Orthopedic Disability'),
        o('physical', 'Yes - Physical Disability'), o('psychosocial', 'Yes - Psychosocial Disability'),
        o('speech_language', 'Yes - Speech and Language Disability'), o('visual', 'Yes - Visual Disability'),
      ] },
      { key: 'victimContact', no: '30', label: 'Contact Information of the victim-survivor', type: 'textarea',
        hint: 'Only a contact the client confirms is safe to use.' },
    ],
  },
  {
    key: 'C',
    title: 'C. Details of the Incident',
    items: [
      { key: 'typeOfViolence', no: '31', label: 'Type of Violence', type: 'multi', groups: [
        { title: 'Intimate partner violence against women and their children', options: [
          o('ipv_physical', 'Physical'), o('ipv_sexual', 'Sexual'), o('ipv_psychological', 'Psychological'), o('ipv_economic', 'Economic')] },
        { title: 'Rape', options: [
          o('rape_intercourse', 'Rape by sexual intercourse'), o('rape_assault', 'Rape by sexual assault'), o('rape_incest', 'Incest'),
          o('rape_statutory', 'Statutory rape'), o('rape_marital', 'Marital rape')] },
        { title: 'Trafficking in persons', options: [
          o('tip_sexual', 'Sexual exploitation'), o('tip_online', 'Online sexual exploitation'), o('tip_forced_labor', 'Forced labor'),
          o('tip_organs', 'Sale or removal of organs'), o('tip_prostitution', 'Prostitution'), o('tip_others', 'Others, specify', 'required')] },
        { title: 'Sexual harassment', options: [
          o('sh_verbal', 'Verbal'), o('sh_physical', 'Physical'),
          o('sh_objects', 'Use of objects, pictures, letters, or notes with sexual underpinnings'), o('sh_others', 'Others, specify', 'required')] },
        { title: 'Child abuse, exploitation, and discrimination', options: [
          o('child_prostitution', 'Engage, facilitate, promote or attempt to commit child prostitution'),
          o('child_sexual', 'Sexual Intercourse or lascivious conduct'), o('child_others', 'Others, specify', 'required')] },
        { title: 'Gender-based Streets and Public Spaces Sexual Harassment', options: [
          o('gss_catcalling', 'Catcalling/Wolf-whistling'), o('gss_slurs', 'Misogynistic, transphobic, homophobic, sexist slurs'),
          o('gss_flashing', 'Public Masturbation/Flashing of private parts'), o('gss_groping', 'Groping'),
          o('gss_gestures', 'Offensive Body Gestures'), o('gss_leering', 'Instrusive gazing/Leering'), o('gss_stalking', 'Stalking/Cyberstalking'),
          o('gss_sharing', 'Uploading and sharing of photos/videos/information'), o('gss_impersonating', 'Impersonating identities'),
          o('gss_others', 'Others, specify', 'required')] },
        { title: 'Other', options: [
          o('voyeurism', 'Photo and video voyeurism'), o('child_pornography', 'Child pornography'),
          o('lasciviousness', 'Acts of lasciviousness'), o('concubinage', 'Concubinage'), o('others', 'Others', 'required')] },
      ] },
      { key: 'description', no: '32', label: 'Description of the Incident', type: 'textarea',
        hint: 'Summarize the incident using exact words of client as much as possible, answering the what, when, where, who, and how of reporting.' },
      { key: 'incidentDate', no: '33', label: 'Date of the Incident', type: 'date' },
      { key: 'incidentTime', no: '34', label: 'Time of the Incident', type: 'time' },
      { key: 'incidentLocation', no: '35', label: 'Geographic Location of the Incident', type: 'location', parts: LOCATION_PARTS },
      { key: 'typeOfPlace', no: '36', label: 'Type of Place of Incident', type: 'single', options: [
        o('conjugal_home', 'Conjugal Home'), o('victims_home', 'Victim\'s Home'), o('perpetrators_home', 'Perpetrator\'s Home'),
        o('malls_hotels', 'Malls/Hotels'), o('school', 'School'), o('workplace', 'Workplace'), o('puv', 'Public Utility Vehicle (PUV)'),
        o('evacuation', 'Evacuation area'), o('other_public', 'Other public spaces, specify', 'required'),
      ] },
      { key: 'electronicMeans', no: '37', label: 'Was the incident perpetuated via electronic means?', type: 'yesNoSpecify',
        yesLabel: 'Yes, please specify medium used (e.g. Facebook, SMS, etc)' },
      { key: 'harmfulPractice', no: '38', label: 'Was the incident a result of a harmful traditional practice?', type: 'yesNoSpecify',
        yesLabel: 'Yes, please specify the practice (e.g. forced marriage)' },
      { key: 'conflictArea', no: '39', label: 'Did the incident happen in a conflict area?', type: 'yesNoDetail', detailOptions: [
        o('insurgency', 'Insurgency'), o('violent_extremism', 'Violent extremism'), o('tribal_violence', 'Tribal violence'),
        o('political_violence', 'Political violence'), o('rido', 'Rido'), o('others', 'Others, specify', 'required')] },
      { key: 'calamityArea', no: '40', label: 'Did the incident happen in a calamity area?', type: 'yesNoDetail', detailOptions: [
        o('human_induced', 'Human-induced disaster, specify', 'required'), o('natural_hazard', 'Natural hazard, specify', 'required')] },
    ],
  },
  {
    key: 'D',
    title: 'D. Alleged Perpetrator Information',
    items: [
      { key: 'perpName', no: '41', label: 'Name', type: 'name', parts: NAME_ALIAS_PARTS },
      { key: 'perpSex', no: '42', label: 'Sex', type: 'single', options: [o('male', 'Male'), o('female', 'Female')] },
      { key: 'perpBirthdate', no: '43', label: 'Birthdate', type: 'date' },
      { key: 'perpPlaceOfBirth', no: '44', label: 'Place of Birth', type: 'place', parts: PLACE_PARTS },
      { key: 'perpAge', no: '45', label: 'Age', type: 'number' },
      { key: 'perpMinorGuardian', no: '46', label: 'If the perpetrator is a minor, please indicate Name and Contact Info of Parent/Guardian', type: 'textarea',
        applies: r => { const a = age(r, 'perpAge'); return a !== null && a < 18 ? 'required' : a === null ? 'optional' : 'hidden'; } },
      { key: 'perpNationality', no: '47', label: 'Nationality', type: 'single', options: NATIONALITY },
      { key: 'perpOccupation', no: '48', label: 'Main Occupation', type: 'text' },
      { key: 'perpReligion', no: '49', label: 'Religion', type: 'single', options: RELIGION },
      { key: 'perpAddress', no: '50', label: 'Current Address', type: 'address', parts: ADDRESS_PARTS },
      { key: 'perpRelationship', no: '51', label: 'Relationship of Perpetrator to Victim-Survivor', type: 'multi', groups: [
        { title: 'Personal / Family', options: [
          o('current_spouse', 'Current spouse/ partner'), o('former_spouse', 'Former spouse/ partner'),
          o('current_dating', 'Current fiancé/ dating relationship'), o('former_dating', 'Former fiancé/ dating relationship'),
          o('neighbors_peers', 'Neighbors/ peers/ coworkers/ classmates'),
          o('immediate_family', 'Immediate family members, specify', 'required'), o('stepfamily', 'Stepfamily members, specify', 'required'),
          o('other_relatives', 'Other relatives, specify', 'required')] },
        { title: 'Persons of Authority', options: [
          o('employer', 'Employer/ manager/ supervisor'), o('employer_agent', 'Agent of the employer'), o('teacher', 'Teacher/ instructor/ professor'),
          o('coach', 'Coach / trainer'), o('religious', 'Religious leaders / workers'), o('community', 'Community leaders / workers')] },
        { title: 'Others', options: [o('stranger', 'Stranger'), o('unknown', 'Unknown'), o('others', 'Specify', 'required')] },
      ] },
      { key: 'perpActorType', label: 'If the incident happened in a conflict or calamity area, indicate if the alleged perpetrator is a:', type: 'multi',
        applies: r => inConflictOrCalamity(r) ? 'required' : 'hidden',
        groups: [
          { title: 'State Actor', options: [o('government_official', 'Government official'), o('military', 'Peace and security sector - Military'),
            o('police', 'Peace and security sector - Police'), o('paramilitary', 'Peace and security sector - Paramilitary')] },
          { title: 'Non-State Actor', options: [o('insurgent', 'Insurgent'), o('rebel', 'Rebel'), o('violent_extremist', 'Violent extremist'), o('militia', 'Militia')] },
        ] },
      { key: 'signatureClient', label: 'Signature over printed name of the victim, parent, or guardian - signed on the paper form', type: 'confirm',
        applies: () => 'optional' },
      { key: 'signatureOfficer', label: 'Signature over printed name of the intake officer - signed on the paper form', type: 'confirm',
        applies: () => 'optional' },
    ],
  },
];

export const ALL_ITEMS: Item[] = INTAKE_SECTIONS.flatMap(s => s.items);
export const ITEM_BY_KEY: Record<string, Item> = Object.fromEntries(ALL_ITEMS.map(i => [i.key, i]));

export const optionsOf = (i: Item): Option[] => i.options ?? i.groups?.flatMap(g => g.options) ?? i.detailOptions ?? [];
export const appliesTo = (i: Item, r: Responses) => i.applies ? i.applies(r) : 'required';

/** Whether an answer actually says something (a value, or a reason there is none). */
export function isAnswered(i: Item, a: Answer | undefined): boolean {
  if (!a) return false;
  if (a.marker) return true;
  const v = a.value;
  const needSpecify = (value: string) => {
    const opt = optionsOf(i).find(x => x.value === value);
    return opt?.specify === 'required' ? Boolean(a.specify?.[value]?.trim()) : true;
  };
  switch (i.type) {
    case 'name': case 'place': case 'location':
      return Boolean(v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some(x => String(x).trim()));
    case 'address':
      return Boolean(a.homeless) || Boolean(v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some(x => String(x).trim()));
    case 'multi':
      return Array.isArray(v) && v.length > 0 && v.every(needSpecify);
    case 'single':
      return typeof v === 'string' && v !== '' && needSpecify(v);
    case 'yesNoSpecify':
      return v === 'no' || (v === 'yes' && Boolean(a.specify?.yes?.trim()));
    case 'yesNoDetail':
      return v === 'no' || (v === 'yes' && Boolean(a.detail) && (() => {
        const opt = i.detailOptions?.find(x => x.value === a.detail);
        return opt?.specify === 'required' ? Boolean(a.specify?.[a.detail!]?.trim()) : true;
      })());
    case 'confirm':
      return v === 'yes';
    default:
      return typeof v === 'string' && v.trim() !== '';
  }
}

/** Every item that must be answered (or marked N/A, Unknown or Declined) before the intake can be completed. */
export function missingForCompletion(r: Responses): Item[] {
  return ALL_ITEMS.filter(i => appliesTo(i, r) === 'required' && !isAnswered(i, r[i.key]));
}
