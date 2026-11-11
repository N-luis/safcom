/**
 * The public Emergency Hotlines shown on the landing page. The one place to
 * change a name or a number: each number is shown and copied exactly as
 * written here, so keep its formatting.
 */
export interface Hotline {
  name: string;
  numbers: readonly string[];
}

export const EMERGENCY_HOTLINES: readonly Hotline[] = [
  { name: 'BARANGAY OFFICE', numbers: ['0922-709-0700'] },
  { name: 'PNP BOCAUE', numbers: ['0998-598-5376', '(044) 309-3314'] },
  { name: 'BUREAU OF FIRE PROTECTION', numbers: ['0917-804-6722', '0947-732-5198'] },
  { name: 'BOCAUE WATER DISTRICT', numbers: ['0933-829-5903', '(044) 692-1659'] },
  { name: 'BOCAUE RESCUE / AMBULANCE', numbers: ['0936-330-9020'] },
  { name: 'PHILIPPINE RED CROSS', numbers: ['(044) 662-5922'] },
  { name: 'MERALCO', numbers: ['0917-551-6211', '0920-971-6211'] },
];
