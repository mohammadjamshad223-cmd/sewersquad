import { prisma } from "@/server/db";
import { integrations } from "@/server/env";
import type { Actor } from "@/server/auth/session";
import { preferenceTypesFor } from "@/server/services/notifications";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmailForm, MfaPanel, PasswordForm, PreferencesForm, ProfileForm, SessionsPanel } from "./account-forms";

/** Profile, security and notification preferences — the same component in every portal. */
export async function AccountSettings({ actor }: { actor: Actor }) {
  const [user, sessions, prefs] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true, phone: true, email: true } }),
    prisma.session.count({ where: { userId: actor.userId, expiresAt: { gt: new Date() } } }),
    prisma.notificationPreference.findMany({ where: { userId: actor.userId } }),
  ]);
  const rows = preferenceTypesFor(actor.kind).map(([type, meta]) => {
    const p = prefs.find((x) => x.type === type);
    return { type, label: meta.label, email: p ? p.email : meta.defaults.email, sms: p ? p.sms : meta.defaults.sms };
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Profile" description="Your name and contact details." />
        <CardBody className="space-y-6">
          <ProfileForm name={user.name} phone={user.phone} />
          <div className="border-t pt-5">
            <EmailForm email={user.email} />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Password" />
        <CardBody>
          <PasswordForm />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Two-factor authentication" />
        <CardBody>
          <MfaPanel enabled={actor.mfaEnabled} required={actor.mfaEnrollmentRequired || (process.env.REQUIRE_ADMIN_MFA === "true" && ["super_admin", "admin", "accounting"].includes(actor.roleKey ?? ""))} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sessions" />
        <CardBody>
          <SessionsPanel count={sessions} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Notification preferences" description="Choose how you'd like to hear from us. In-app notifications are always on." />
        <CardBody>
          <PreferencesForm rows={rows} smsAvailable={integrations.sms()} />
        </CardBody>
      </Card>
    </div>
  );
}
