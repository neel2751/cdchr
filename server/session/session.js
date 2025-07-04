"use server";

import { options } from "@/app/api/auth/[...nextauth]/option";
import { getServerSession } from "next-auth";

export async function getServerSideProps() {
  const session = await getServerSession(options);
  if (!session) {
    return {
      redirect: {
        destination: "/auth/login",
        permanent: false,
      },
    };
  }
  return {
    props: {
      session,
    },
  };
}
