#!/bin/bash
# ---------------------------------------------------------------------------
# Codemod: Rename patient-engagement → customer-engagement
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Step 1: Copy directory ==="
cp -R cartridges/patient-engagement cartridges/customer-engagement
rm -rf cartridges/customer-engagement/dist
rm -rf cartridges/customer-engagement/node_modules
rm -rf cartridges/customer-engagement/coverage

echo "=== Step 2: Bulk text replacements in cartridges/customer-engagement ==="

# Order matters: longer/more-specific strings first to avoid partial matches

find cartridges/customer-engagement/src -type f -name "*.ts" | while read -r file; do
  sed -i '' \
    -e 's/bootstrapPatientEngagementCartridge/bootstrapCustomerEngagementCartridge/g' \
    -e 's/PatientEngagementCartridge/CustomerEngagementCartridge/g' \
    -e 's/PatientEngagementConfig/CustomerEngagementConfig/g' \
    -e 's/PATIENT_ENGAGEMENT_MANIFEST/CUSTOMER_ENGAGEMENT_MANIFEST/g' \
    -e 's/PATIENT_ENGAGEMENT_ACTIONS/CUSTOMER_ENGAGEMENT_ACTIONS/g' \
    -e 's/DEFAULT_PATIENT_ENGAGEMENT_POLICIES/DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES/g' \
    -e 's/DEFAULT_PATIENT_ENGAGEMENT_GUARDRAILS/DEFAULT_CUSTOMER_ENGAGEMENT_GUARDRAILS/g' \
    -e 's/PATIENT_JOURNEY_SCHEMA/CUSTOMER_JOURNEY_SCHEMA/g' \
    -e 's/PatientMetricsSnapshot/ContactMetricsSnapshot/g' \
    -e 's/PatientConsent/ContactConsent/g' \
    -e 's/TreatmentAffinityInput/ServiceAffinityInput/g' \
    -e 's/TreatmentAffinityResult/ServiceAffinityResult/g' \
    -e 's/TreatmentType/ServiceType/g' \
    -e 's/ClinicType/BusinessType/g' \
    -e 's/computeTreatmentAffinity/computeServiceAffinity/g' \
    -e 's/patient-engagement\./customer-engagement./g' \
    -e 's/"patient-engagement"/"customer-engagement"/g' \
    -e "s/'patient-engagement'/'customer-engagement'/g" \
    -e 's/Patient Engagement/Customer Engagement/g' \
    -e 's/patient lifecycle/customer lifecycle/g' \
    -e 's/patient journey/customer journey/g' \
    -e 's/patient objection/customer objection/g' \
    -e 's/patient conversation/customer conversation/g' \
    -e 's/patient escalation/customer escalation/g' \
    -e 's/patientId/contactId/g' \
    -e 's/patientName/contactName/g' \
    -e 's/patientPhone/contactPhone/g' \
    -e 's/treatmentType/serviceType/g' \
    -e 's/treatmentValue/serviceValue/g' \
    -e 's/treatmentInterest/serviceInterest/g' \
    -e 's/treatment_proposed/service_proposed/g' \
    -e 's/treatment_accepted/service_accepted/g' \
    -e 's/treatment_scheduled/service_scheduled/g' \
    -e 's/treatment_completed/service_completed/g' \
    -e 's/treatments_proposed/services_proposed/g' \
    -e 's/treatments_accepted/services_accepted/g' \
    -e 's/treatments_scheduled/services_scheduled/g' \
    -e 's/treatments_completed/services_completed/g' \
    -e 's/repeat_patient/repeat_customer/g' \
    -e 's/repeat_patients/repeat_customers/g' \
    -e 's/dormant_patients/dormant_customers/g' \
    -e 's/lost_patients/lost_customers/g' \
    -e 's/Repeat Patient/Repeat Customer/g' \
    -e 's/totalPatients/totalContacts/g' \
    -e 's/Total patients/Total contacts/g' \
    -e 's/averageTreatmentValue/averageServiceValue/g' \
    -e 's/Treatment Proposed/Service Proposed/g' \
    -e 's/Treatment Accepted/Service Accepted/g' \
    -e 's/Treatment Scheduled/Service Scheduled/g' \
    -e 's/Treatment Completed/Service Completed/g' \
    -e 's/treatment plan/service plan/g' \
    -e 's/clinicType/businessType/g' \
    -e 's/{{patientId}}/{{contactId}}/g' \
    -e 's/{{patientName}}/{{contactName}}/g' \
    -e 's/{{treatmentType}}/{{serviceType}}/g' \
    -e 's/currentTreatment/currentService/g' \
    -e 's/previousTreatments/previousServices/g' \
    "$file"
done

echo "=== Step 3: Update package.json ==="
sed -i '' \
  -e 's/@switchboard\/patient-engagement/@switchboard\/customer-engagement/g' \
  cartridges/customer-engagement/package.json

echo "=== Step 4: Rename file treatment-affinity.ts → service-affinity.ts ==="
if [ -f "cartridges/customer-engagement/src/core/scoring/treatment-affinity.ts" ]; then
  mv cartridges/customer-engagement/src/core/scoring/treatment-affinity.ts \
     cartridges/customer-engagement/src/core/scoring/service-affinity.ts
fi
# Update imports referencing the old filename
find cartridges/customer-engagement/src -type f -name "*.ts" | while read -r file; do
  sed -i '' 's/treatment-affinity/service-affinity/g' "$file"
done

echo "=== Step 5: Update external files ==="

# apps/api/package.json
sed -i '' 's/@switchboard\/patient-engagement/@switchboard\/customer-engagement/g' \
  apps/api/package.json

# apps/chat/package.json
sed -i '' 's/@switchboard\/patient-engagement/@switchboard\/customer-engagement/g' \
  apps/chat/package.json

# apps/mcp-server/package.json
sed -i '' 's/@switchboard\/patient-engagement/@switchboard\/customer-engagement/g' \
  apps/mcp-server/package.json

# apps/api/src/app.ts
sed -i '' \
  -e 's/@switchboard\/patient-engagement/@switchboard\/customer-engagement/g' \
  -e 's/bootstrapPatientEngagementCartridge/bootstrapCustomerEngagementCartridge/g' \
  -e 's/DEFAULT_PATIENT_ENGAGEMENT_POLICIES/DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES/g' \
  -e 's/"patient-engagement"/"customer-engagement"/g' \
  -e 's/Patient Escalation/Customer Escalation/g' \
  -e 's/patient escalation/customer escalation/g' \
  -e 's/patientId/contactId/g' \
  apps/api/src/app.ts

# apps/chat/src/cartridge-registrar.ts
sed -i '' \
  -e 's/@switchboard\/patient-engagement/@switchboard\/customer-engagement/g' \
  -e 's/bootstrapPatientEngagementCartridge/bootstrapCustomerEngagementCartridge/g' \
  -e 's/DEFAULT_PATIENT_ENGAGEMENT_POLICIES/DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES/g' \
  -e 's/"patient-engagement"/"customer-engagement"/g' \
  apps/chat/src/cartridge-registrar.ts

# apps/mcp-server/src/auto-register.ts
sed -i '' \
  -e 's/patient-engagement/customer-engagement/g' \
  apps/mcp-server/src/auto-register.ts

# skins/clinic.json
sed -i '' \
  -e 's/patient-engagement/customer-engagement/g' \
  -e 's/patientName/contactName/g' \
  -e 's/patientId/contactId/g' \
  -e 's/{{patientName}}/{{contactName}}/g' \
  -e 's/Patient Engagement/Customer Engagement/g' \
  skins/clinic.json

# .github/CODEOWNERS
sed -i '' 's/patient-engagement/customer-engagement/g' .github/CODEOWNERS

# Dockerfile
sed -i '' 's/patient-engagement/customer-engagement/g' Dockerfile

# Test files
for f in \
  apps/api/src/__tests__/cartridge-contracts.test.ts \
  apps/api/src/__tests__/skin-enforcement.test.ts \
  packages/core/src/skin/__tests__/skin.test.ts \
  packages/core/src/tool-registry/__tests__/tool-registry.test.ts; do
  if [ -f "$f" ]; then
    sed -i '' \
      -e 's/@switchboard\/patient-engagement/@switchboard\/customer-engagement/g' \
      -e 's/bootstrapPatientEngagementCartridge/bootstrapCustomerEngagementCartridge/g' \
      -e 's/PatientEngagementCartridge/CustomerEngagementCartridge/g' \
      -e 's/DEFAULT_PATIENT_ENGAGEMENT_POLICIES/DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES/g' \
      -e 's/PATIENT_ENGAGEMENT_MANIFEST/CUSTOMER_ENGAGEMENT_MANIFEST/g' \
      -e 's/PATIENT_ENGAGEMENT_ACTIONS/CUSTOMER_ENGAGEMENT_ACTIONS/g' \
      -e 's/patient-engagement\./customer-engagement./g' \
      -e 's/"patient-engagement"/"customer-engagement"/g' \
      -e "s/'patient-engagement'/'customer-engagement'/g" \
      -e 's/Patient Engagement/Customer Engagement/g' \
      "$f"
  fi
done

echo "=== Step 6: Remove old directory ==="
rm -rf cartridges/patient-engagement

echo "=== Done ==="
