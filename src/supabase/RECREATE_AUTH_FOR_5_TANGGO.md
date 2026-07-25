# Recreate Auth Account for 5@tanggo.ca

## User Information
- **User ID**: `e861f114-7a95-47c3-a4ca-465e7c405aac`
- **Email**: `5@tanggo.ca`
- **Name**: Owner Account

## Problem
The account exists in `users` table but likely missing from `auth.users` table, causing 400 Bad Request login errors.

## Solution: Use Edge Function

Call the `create-employee-auth` Edge Function to recreate the auth account:

### Method 1: Using curl (Terminal)

```bash
curl -X POST 'https://iagcamwcfuiopmwefohz.supabase.co/functions/v1/create-employee-auth' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "method": "password",
    "employee_email": "5@tanggo.ca",
    "employee_id": "e861f114-7a95-47c3-a4ca-465e7c405aac",
    "first_name": "Owner",
    "last_name": "Account",
    "full_name": "Owner Account",
    "temporary_password": "TempPassword123!"
  }'
```

### Method 2: Using JavaScript/Fetch

```javascript
const response = await fetch(
  'https://iagcamwcfuiopmwefohz.supabase.co/functions/v1/create-employee-auth',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer YOUR_SERVICE_ROLE_KEY`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      method: 'password',
      employee_email: '5@tanggo.ca',
      employee_id: 'e861f114-7a95-47c3-a4ca-465e7c405aac',
      first_name: 'Owner',
      last_name: 'Account',
      full_name: 'Owner Account',
      temporary_password: 'TempPassword123!'
    })
  }
);

const result = await response.json();
console.log(result);
```

### Method 3: Via Supabase Dashboard

1. Go to Supabase Dashboard > Authentication > Users
2. Click "Add User"
3. Enter:
   - Email: `5@tanggo.ca`
   - Password: (set a temporary password)
   - **IMPORTANT**: The user ID should be `e861f114-7a95-47c3-a4ca-465e7c405aac`
   - Note: You may need to use the Admin API to set the specific ID

## After Creating Auth Account

1. Try logging in with:
   - Email: `5@tanggo.ca`
   - Password: The temporary password you set
2. Change password immediately after first login

## If Edge Function Doesn't Work

If the Edge Function fails because the account already exists, use password reset instead:

```bash
curl -X POST 'https://iagcamwcfuiopmwefohz.supabase.co/functions/v1/create-employee-auth' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "method": "reset",
    "employee_email": "5@tanggo.ca",
    "employee_id": "e861f114-7a95-47c3-a4ca-465e7c405aac"
  }'
```

This will send a password reset email to `5@tanggo.ca`.


