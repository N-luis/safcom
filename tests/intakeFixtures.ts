/** Fictional intake answers shared by the intake preview tests. No real person. */
import type { Responses } from '../lib/officialIntakeForm';

// A fictional account, long enough to run past one page.
export const NARRATIVE_END = 'She said the last incident ended when the neighbour knocked on the door.';
export const narrative = (paras: number) => [
  ...Array.from({ length: paras }, (_, i) => `Paragraph ${i + 1}: According to the client, the incident began in the evening after an argument about household money. She said he shouted, took her phone and would not let her leave the kitchen.`),
  NARRATIVE_END,
].join('\n\n');

export const fictional = (): Responses => ({
  dateOfIntake: { value: '2026-11-02' },
  intakeBy: { value: { last: 'Reyes', first: 'Ana', middle: 'B', extension: '' } },
  positionTitle: { value: 'VAWC Desk Officer' },
  handlingOrganization: { value: 'Barangay VAWC Desk (fictional test)' },
  officeAddress: { value: 'Barangay Hall, 1 Test Road' },
  clientCode: { value: 'CC-PROBE-0042' },
  incidentNo: { value: 'INC-PROBE-0099' },
  reportingMode: { value: 'victim_survivor' },
  victimName: { value: { last: 'Dela Prueba', first: 'Maria', middle: 'S', extension: '', others: 'Mia' } },
  sexAtBirth: { value: 'female' },
  diverseSogie: { marker: 'declined' },
  birthdate: { value: '1995-04-10' },
  age: { value: '31' },
  civilStatus: { value: 'consensual' },
  nationality: { value: 'filipino' },
  religion: { value: 'others', specify: { others: 'Fictional Faith' } },
  currentAddress: { value: { houseNumber: '12', street: 'Sampaguita St', barangay: 'Test', city: 'Testville', province: 'Test Province', region: 'III' } },
  typeOfViolence: { value: ['ipv_physical', 'ipv_psychological', 'tip_others'], specify: { tip_others: 'Forced to sell goods' } },
  description: { value: narrative(2) },
  incidentDate: { value: '2026-10-30' },
  incidentTime: { value: '21:30' },
  electronicMeans: { value: 'yes', specify: { yes: 'SMS threats' } },
  conflictArea: { value: 'no' },
  calamityArea: { value: 'no' },
  perpName: { value: { last: 'Prueba', first: 'Juan', middle: '', extension: 'Jr.', others: '' } },
  perpSex: { value: 'male' },
  perpRelationship: { value: ['current_spouse'] },
});

