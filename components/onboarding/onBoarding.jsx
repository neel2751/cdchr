import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { CardDescription, CardTitle } from "../ui/card";
import { HelpCircle } from "lucide-react";

const OnBoardingDialog = ({ open, handleClose }) => {
  const { data: session } = useSession();

  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "Welcome to CDC Group",
      image: "/images/welcome.svg",
      content:
        " Welcome to CDC Group! We are thrilled to have you on board. This onboarding process will guide you through our company, its values, and how we can work together effectively.",
    },
    {
      title: "What We Do",
      image: "/images/what-we-do.svg",
      content:
        "At CDC Group, we are committed to making a positive impact in the world. Our mission is to support sustainable development by investing in businesses that create jobs, drive economic growth, and improve lives.",
    },
    {
      title: "Leadership Team",
      image: "/images/leadership.svg",
      teamImages: [
        {
          name: "Bhuiyan",
          position: "CEO & CDM",
          image: "https://cdc.construction/images/team/Mohammad.jpg",
        },
        {
          name: "Sadequl Alam",
          position: "Director",
          image: "https://cdc.construction/images/team/Md Sadequl.jpg",
        },
        {
          name: "Najia Nitu",
          position: "Director",
          image: "https://cdc.construction/images/team/Najia.jpg",
        },
      ],
      content:
        "Meet our leadership team! They are dedicated to guiding our company towards success and ensuring we stay true to our mission. Their expertise and vision are invaluable to our growth.",
    },
    {
      title: "Our Values",
      image: "/images/values.svg",
      content:
        "At CDC Group, we value integrity, innovation, and collaboration. We believe in creating a positive work environment where everyone can thrive and contribute to our mission.",
    },
    {
      title: "Your Role",
      image: "/images/your-role.svg",
      content:
        "As a new member of our team, you play a crucial role in helping us achieve our goals. Your skills and contributions are essential to our success.",
    },
    {
      title: "Resources & Support",
      image: "/images/resources.svg",
      content:
        "We provide various resources and support to help you succeed in your role. From training programs to mentorship opportunities, we are here to assist you.",
    },
    {
      title: "Your Feedback",
      image: "/images/feedback.svg",
      content:
        "Your feedback is important to us! We encourage you to share your thoughts and suggestions on how we can improve our onboarding process and overall work environment. don't worry your feedback will be anonymous.",
    },
    {
      title: "Reday, Set, Grow!",
      image: "/images/get-started.svg",
      content:
        "Thank you for completing the onboarding process! We are excited to have you as part of the CDC Group family. If you have any questions or need assistance, please don't hesitate to reach out to your manager or HR.",
    },
  ];

  const nextStep = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <h2 className="text-lg font-semibold">
            Hi 🎉, {session?.user?.name || "User"}{" "}
            <span className="text-gray-500 text-sm">
              ({step + 1}/{steps.length})
            </span>
          </h2>
          {steps[step].teamImages ? (
            <div className="flex flex-wrap justify-around gap-4 mt-4 w-full bg-gradient-to-b from-indigo-50 via-rose-50 to-blue-50 p-4 rounded-lg mb-4">
              {steps[step].teamImages.map((member, index) => (
                <div key={index} className="text-center">
                  <div className="flex flex-col items-center">
                    <Image
                      src={member.image}
                      alt={member.name}
                      width={80}
                      height={80}
                      className="rounded-full mb-2"
                    />
                    <div>
                      <CardTitle>{member.name}</CardTitle>
                      <CardDescription>{member.position}</CardDescription>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Image
              src={steps[step].image}
              alt={steps[step].title}
              width={100}
              height={100}
              className="my-4 w-full h-auto rounded-lg"
            />
          )}
          <DialogTitle>{steps[step].title}</DialogTitle>
          <DialogDescription>{steps[step].content}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {step > 0 && <Button onClick={prevStep}>Previous</Button>}

          {step < steps.length - 1 ? (
            <Button onClick={nextStep}>Next</Button>
          ) : (
            <Button onClick={handleClose}>Finish</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const OnBoarding = () => {
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem("hasSeenOnboarding");
    if (!hasSeenOnboarding) {
      setShowDialog(true);
      localStorage.setItem("hasSeenOnboarding", "true");
    }
  }, []);

  const handleDialogClose = () => {
    setShowDialog(false);
  };

  return (
    <div>
      <OnBoardingDialog open={showDialog} handleClose={handleDialogClose} />
      <Button onClick={() => setShowDialog(true)} variant="outline" size={"sm"}>
        <HelpCircle />
        OnBoarding Guide
      </Button>
    </div>
  );
};

export default OnBoarding;
