import { getServerSession } from 'next-auth';
import { authOptions } from '../api/auth/[...nextauth]/authOptions';
import { prisma } from '@/lib/prisma';
import SignInForm from './signin';

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return <SignInForm />;
  }
  const appointments = await prisma.appointment.findMany({ orderBy: { startsAt: 'desc' } });
  return (
    <div className="p-8">
      <h1 className="text-3xl mb-4">Admin</h1>
      <form action="/api/auth/signout" method="post">
        <button className="underline">Sign out</button>
      </form>
      <table className="w-full mt-4 text-sm">
        <thead>
          <tr>
            <th>Ref</th><th>Name</th><th>Service</th><th>Date</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((a: any) => (
            <tr key={a.id} className="border-b border-gray-700">
              <td>{a.ref}</td>
              <td>{a.name}</td>
              <td>{a.service}</td>
              <td>{a.startsAt.toISOString()}</td>
              <td>{a.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
