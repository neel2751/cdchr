"use server";
import { connect } from "@/db/db";
import LeaveRequestModel from "@/models/leaveRequestModel";
import { getServerSideProps } from "@/server/session/session";
import { GoogleGenAI } from "@google/genai";

export async function getUserLeaves() {
  try {
    const { props } = await getServerSideProps();
    const employeeId = props?.session?.user?._id;
    await connect();

    const pipeline = [
      {
        $lookup: {
          from: "officeemployes",
          localField: "employeeId",
          foreignField: "_id",
          as: "employee",
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [{ $arrayElemAt: ["$employee", 0] }, "$$ROOT"],
          },
        },
      },
      {
        $project: {
          employee: 0,
          email: 0,
          phoneNumber: 0,
          employeeId: 0,
          _id: 0,
          password: 0,
          immigrationType: 0,
          company: 0,
          department: 0,
          isSuperAdmin: 0,
          isAdmin: 0,
        },
      },
    ];

    return await LeaveRequestModel.aggregate(pipeline);
  } catch (error) {
    return null;
  }
}

export const useGemini = async (message) => {
  const userData = await getUserLeaves(); // or getFullUserData()
  const prompt = `
You are an HR assistant. Here's the user data:
${JSON.stringify(userData, null, 2)}

Now answer this question:
"${message}"
`;

  const ai = new GoogleGenAI({
    apiKey: process.env.GENAI_API_KEY,
  });

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
    config: {
      systemInstruction: [
        "You are a helpful HR assistant.",
        "The user is an admin. They may be asking about other employees or general data. Use the full context below to answer professionally",
        "Your mission to give prodcitivity as well do not guess the answer if you do not have any answer give answer professionally",
        "Don't Expose any ID just give Data",
      ],
    },
  });
  return response.text;
};
