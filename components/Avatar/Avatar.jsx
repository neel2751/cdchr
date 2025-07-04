import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useAvatar } from "./AvatarContext";
import { cn } from "@/lib/utils";

const AvatarList = () => {
  const defaultAvatars = [
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299943/1a_y6imyc.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299943/2a_qn2sku.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299943/3a_mizal0.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299943/4a_p8v7mt.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299942/5a_pfbtth.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299942/6a_u49qfc.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299942/7a_iqovb5.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299942/8a_fvyuqq.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299942/9a_bhds1b.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299942/10a_gswfya.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299941/11a_ax5vje.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299941/12a_pnovhv.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299941/13a_y3mbq6.jpg",
    "https://res.cloudinary.com/drcjzx0sw/image/upload/v1742299941/15a_zd0e9z.jpg",
  ];

  const { selectedAvatar, setSelectedAvatar } = useAvatar();

  return (
    <div className="flex gap-4 overflow-x-auto p-1 max-w-3xl">
      {defaultAvatars.map((avatar, index) => (
        <Avatar
          key={index}
          className={`h-20 w-20 rounded-lg cursor-pointer hover:ring-2 hover:ring-indigo-600 group transform-gpu shrink-0 ${
            selectedAvatar === avatar ? "ring-2 ring-indigo-600" : ""
          }`}
          onClick={() => setSelectedAvatar(avatar)}
        >
          <AvatarImage
            src={avatar}
            alt={`Avatar ${index + 1}`}
            className="object-cover group-hover:scale-105"
          />
          <AvatarFallback>{index + 1}</AvatarFallback>
        </Avatar>
      ))}
    </div>
  );
};

const UserAvatar = ({ fallbackName, className }) => {
  const { selectedAvatar } = useAvatar();
  return (
    <Avatar className={cn("h-20 w-20", className)}>
      <AvatarImage src={selectedAvatar} alt={fallbackName} />
      <AvatarFallback>
        {fallbackName
          .split(" ")
          .map((n) => n[0])
          .join("")}
      </AvatarFallback>
    </Avatar>
  );
};
export { AvatarList, UserAvatar };
