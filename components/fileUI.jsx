import React from "react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

export default function FileStructure() {
  const fileStructure = [
    {
      name: "src",
      type: "folder",
      children: [
        { name: "index.js", type: "file" },
        { name: "App.js", type: "file" },
        {
          name: "components",
          type: "folder",
          children: [
            { name: "Header.js", type: "file" },
            { name: "Footer.js", type: "file" },
          ],
        },
      ],
    },
    {
      name: "public",
      type: "folder",
      children: [{ name: "index.html", type: "file" }],
    },
    { name: "package.json", type: "file" },
  ];

  const renderFileStructure = (items) =>
    items.map((item, index) => {
      if (item.type === "folder") {
        return (
          <AccordionItem key={index} value={item.name}>
            <AccordionTrigger>{item.name}</AccordionTrigger>
            <AccordionContent>
              <div className="pl-4">{renderFileStructure(item.children)}</div>
            </AccordionContent>
          </AccordionItem>
        );
      }
      return (
        <div key={index} className="pl-4 text-gray-700">
          {item.name}
        </div>
      );
    });

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-4">File Structure</h1>
      <Accordion type="single" collapsible>
        {renderFileStructure(fileStructure)}
      </Accordion>
    </div>
  );
}
