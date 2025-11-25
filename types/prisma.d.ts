declare module '@prisma/client' {
  export class PrismaClient {
    appointment: any;
    serviceConfig: any;
    $disconnect(): Promise<void>;
    $connect(): Promise<void>;
  }
}
