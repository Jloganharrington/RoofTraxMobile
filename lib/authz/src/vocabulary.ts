// Strict role hierarchy, ranked low to high. All access decisions are rank
// comparisons within the same company — there is no separate "reporting tree".
export const ROLES = ['field_rep', 'manager', 'admin', 'super_admin'] as const;

// Which line(s) of business a user works. `insurance_retail` replaces the
// former separate `insurance` and `both` values — every insurance-capable
// rep can also see retail pins, so there is no longer a pure-insurance mode.
export const WORKFLOW_ASSIGNMENTS = ['retail', 'insurance_retail'] as const;

// Which dashboard/module a user operates in.
//   canvasser          — door-knocking field flow
//   inspector_canvasser — additionally gets the forensic inspection module
//   office             — back-office / admin staff
export const DEPARTMENTS = ['canvasser', 'inspector_canvasser', 'office'] as const;

export type Role = (typeof ROLES)[number];
export type WorkflowAssignment = (typeof WORKFLOW_ASSIGNMENTS)[number];
export type Department = (typeof DEPARTMENTS)[number];
