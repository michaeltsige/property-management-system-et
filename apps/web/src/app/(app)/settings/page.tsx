import { redirect } from 'next/navigation';

/** Settings moved into the Organization section. */
export default function SettingsRedirect() {
  redirect('/organization');
}
