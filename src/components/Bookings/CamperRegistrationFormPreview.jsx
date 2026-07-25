import React, { useMemo } from 'react';
import {
  CAMPER_REGISTRATION_SECTION_KEYS,
  CAMPER_REGISTRATION_SECTION_ORDER,
  DEFAULT_AUTHORIZATION_TEXTS,
  sectionEnabled,
} from '../../constants/camperRegistrationForm';
import { TavariStyles } from '../../utils/TavariStyles';

const SAMPLE = {
  camper_info: {
    address: '1510 Richmond St',
    city: 'London',
    postal_code: 'N6G 4V2',
    home_phone: '548-881-4544',
    age_at_camp: '5',
  },
  guardians: {
    guardian_1: { name: 'Sample Parent', primary_phone: '548-881-4544', email: 'parent@example.com' },
    guardian_2: { name: 'Second Guardian', primary_phone: '548-881-8631', email: 'guardian@example.com' },
  },
  custody: { type: 'joint' },
  emergency_contacts: [{ name: 'Emergency Contact', phone: '555-0100' }],
  authorized_pickup: { parent_guardians: true, emergency_contacts: false, other_detail: '' },
  medical_needs: 'Sample medical notes appear here.',
  allergies: [{ allergen: 'Peanuts', potential_symptoms: 'Hives', is_anaphylactic: 'yes', has_epipen: 'yes' }],
  medications: [{ name: 'Sample med', dosage_instructions: '1 tablet', time_to_dispense: 'Noon', refrigeration: 'no' }],
};

const sectionPreviewContent = {
  [CAMPER_REGISTRATION_SECTION_KEYS.camperInfo]: () => (
    <ul style={listStyle}>
      <li>Name & birthday (from camper profile)</li>
      <li>Address, city, postal code, home phone, age at camp</li>
    </ul>
  ),
  [CAMPER_REGISTRATION_SECTION_KEYS.guardians]: () => (
    <ul style={listStyle}>
      <li>Parent/Guardian 1 & 2 — name, phones, email</li>
    </ul>
  ),
  [CAMPER_REGISTRATION_SECTION_KEYS.custody]: () => (
    <p style={pStyle}>Parent/Guardian 1 · 2 · Both · Joint · Other</p>
  ),
  [CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts]: () => (
    <p style={pStyle}>2 rows — name & phone (other than parent/guardian)</p>
  ),
  [CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup]: () => (
    <p style={pStyle}>Parent/Guardian(s) · Emergency contact(s) · Other names + photo ID note</p>
  ),
  [CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation]: (section) => (
    <p style={pStyle}>{section?.prompt || SAMPLE.medical_needs}</p>
  ),
  [CAMPER_REGISTRATION_SECTION_KEYS.allergies]: () => (
    <p style={pStyle}>Allergen, symptoms, anaphylactic, Epi-Pen (repeatable rows)</p>
  ),
  [CAMPER_REGISTRATION_SECTION_KEYS.allergyMedAuthorization]: (section, authTexts) => (
    <p style={pStyle}>{authTexts.allergy_med_admin?.slice(0, 120)}…</p>
  ),
  [CAMPER_REGISTRATION_SECTION_KEYS.medications]: () => (
    <p style={pStyle}>Medication table — name, dosage, time, refrigeration</p>
  ),
  [CAMPER_REGISTRATION_SECTION_KEYS.campAuthorization]: () => (
    <p style={pStyle}>Camp · Medical · Off-premises authorizations + parent signature</p>
  ),
};

const listStyle = { margin: 0, paddingLeft: 18, fontSize: 13, color: TavariStyles.colors.gray700, lineHeight: 1.5 };
const pStyle = { margin: 0, fontSize: 13, color: TavariStyles.colors.gray700, lineHeight: 1.5 };

/**
 * Live preview panel for the camp registration form builder.
 */
const CamperRegistrationFormPreview = ({ template, businessName = '' }) => {
  const authTexts = useMemo(
    () => ({
      ...DEFAULT_AUTHORIZATION_TEXTS,
      ...(template?.fields_config?.authorization_texts || {}),
    }),
    [template]
  );

  if (!template) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: TavariStyles.colors.gray500, fontSize: 13 }}>
        Preview will appear here
      </div>
    );
  }

  const sections = template.fields_config?.sections || {};

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        border: `1px solid ${TavariStyles.colors.gray200}`,
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
          background: TavariStyles.colors.gray50,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase' }}>
          {businessName || 'Your business'}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{template.form_title}</div>
        {template.form_intro ? (
          <p style={{ margin: '6px 0 0', fontSize: 13, color: TavariStyles.colors.gray600, lineHeight: 1.45 }}>
            {template.form_intro}
          </p>
        ) : null}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 8,
            background: TavariStyles.colors.gray50,
            fontSize: 13,
          }}
        >
          <strong>Sample Camper</strong>
          <div style={{ color: TavariStyles.colors.gray600, marginTop: 2 }}>DOB: 29/05/2020</div>
        </div>

        {CAMPER_REGISTRATION_SECTION_ORDER.map((key) => {
          if (!sectionEnabled(template, key)) return null;
          const section = sections[key] || {};
          const label = section.label || key;
          const required = section.required !== false && section.required === true;
          const render = sectionPreviewContent[key];
          return (
            <div
              key={key}
              style={{
                marginBottom: 10,
                borderRadius: 8,
                border: `1px solid ${TavariStyles.colors.gray200}`,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: '#0d9488',
                  color: '#fff',
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                }}
              >
                {label}
                {required ? ' *' : ''}
              </div>
              <div style={{ padding: 10 }}>{render ? render(section, authTexts) : null}</div>
            </div>
          );
        })}

        {(template.fields_config?.custom_fields || []).map((field) => (
          <div
            key={field.field_key}
            style={{
              marginBottom: 10,
              padding: 10,
              borderRadius: 8,
              border: `1px dashed ${TavariStyles.colors.gray300}`,
              fontSize: 13,
            }}
          >
            {field.field_label}
            {field.is_required ? ' *' : ''}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CamperRegistrationFormPreview;
