"use client";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";

function TabDemo({ tabData }) {
  const [activeTab, setActiveTab] = useState(tabData[1]?.value);
  return (
    <Tabs defaultValue={tabData[1]?.value}>
      <ScrollArea className="overflow-x-auto w-full max-w-max border rounded-md px-2">
        <TabsList className="mb-3 h-auto gap-2 rounded-none border-b border-border bg-transparent px-0 py-1 text-foreground flex-nowrap">
          {tabData.map((item) => {
            return (
              <TabsTrigger
                key={item?.value}
                value={item?.value}
                onClick={() => setActiveTab(item?.value)}
                className="relative after:absolute after:inset-x-0 after:bottom-0 after:-mb-1 after:h-0.5 hover:bg-accent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:after:bg-indigo-700 data-[state=active]:hover:bg-accent data-[state=active]:text-indigo-700"
              >
                <item.icon
                  className={`-ms-0.5 me-1.5 ${
                    activeTab === item?.value ? "opacity-100" : "opacity-60"
                  }`}
                  size={16}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                {item?.label}
                {item?.number && (
                  <Badge
                    className="ms-1.5 min-w-5 bg-primary/15 px-1"
                    variant="secondary"
                  >
                    {item?.number}
                  </Badge>
                )}
                {item?.text && <Badge className="ms-1.5">{item?.text}</Badge>}
              </TabsTrigger>
            );
          })}
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <TabsContent value={activeTab || tabData[0]?.value}>
        {tabData.find(({ value }) => value === activeTab)?.content}
      </TabsContent>
    </Tabs>
  );
}

export { TabDemo };
