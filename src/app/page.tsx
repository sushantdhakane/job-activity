import { auth } from "@/lib/auth";
import { LoginPage } from "@/components/LoginPage";
import { Dashboard } from "@/components/Dashboard";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    return <LoginPage />;
  }

  return <Dashboard user={session.user} />;
}
