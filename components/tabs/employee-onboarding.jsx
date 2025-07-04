"use client";
import { useState } from "react";
import {
  CalendarIcon,
  ClockIcon,
  InfoIcon,
  LaptopIcon,
  LogOutIcon,
  Trash2Icon,
  ScrollText,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  GraduationCap,
  Building2,
  Users2,
  Link2,
  Plus,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardDescription,
  CardTitle,
  CardContent,
  CardFooter,
} from "../ui/card";
import { Button } from "../ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { differenceInDays, format } from "date-fns";
import * as AccordionPrimitive from "@radix-ui/react-accordion";

export default function EmployeeOnboarding() {
  return (
    <div>
      <CardTitle>Onboarding Status</CardTitle>
      <CardDescription>
        Welcome to our company! We're excited to have you on board. Below, you
        can see the status of your onboarding process.
      </CardDescription>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <LaptopIcon className="text-2xl" />
          <CardTitle className="text-nowrap">Device Setup</CardTitle>
          <CardDescription>
            Your device is set up and ready to use. You can access all company
            resources and tools from your laptop.
          </CardDescription>
          <Button variant="success">Complete</Button>
        </div>
        <div className="flex items-center gap-4">
          <InfoIcon className="text-2xl" />
          <CardTitle>Company Information</CardTitle>
          <CardDescription>
            You have been provided with all necessary company information,
            including our mission statement, values, and policies.
          </CardDescription>
          <Button variant="success">Complete</Button>
        </div>
        <div className="flex items-center gap-4">
          <LogOutIcon className="text-2xl" />
          <CardTitle>Security and Access</CardTitle>
          <CardDescription>
            You have been granted access to all necessary company resources and
            tools. You can log in to your account to access them.
          </CardDescription>
          <Button variant="success">Complete</Button>
        </div>
        <div className="flex items-center gap-4">
          <Trash2Icon className="text-2xl" />
          <CardTitle>Termination</CardTitle>
          <CardDescription>
            You have been terminated from the company. Please return all company
            property and equipment.
          </CardDescription>
          <Button variant="error">Complete</Button>
        </div>
        <div className="flex items-center gap-4">
          <ClockIcon className="text-2xl" />
          <CardTitle>Time Off</CardTitle>
          <CardDescription>
            You have been granted time off for the next two weeks. You can use
            this time to relax and recharge.
          </CardDescription>
          <Button variant="success">Complete</Button>
        </div>
        <div className="flex items-center gap-4">
          <CalendarIcon className="text-2xl" />
          <CardTitle>Leave Request</CardTitle>
          <CardDescription>
            You have submitted a leave request for the next two weeks. Your
            request is being reviewed and you will be notified soon.
          </CardDescription>
          <Button variant="success">Complete</Button>
        </div>
      </div>
      <EmployeeOnboardings />
    </div>
  );
}
const EmployeeOnboardings = () => {
  const [onboardingItems, setOnboardingItems] = useState([
    {
      id: "1",
      title: "Employee Handbook",
      description: "Read and acknowledge the company policies and procedures",
      type: "document",
      category: "HR Documents",
      dueDate: "2025-03-10",
      completed: true,
      completedAt: "2024-03-05T14:30:00Z",
      link: "#",
      icon: Link2,
    },
    {
      id: "2",
      title: "Code of Conduct",
      description: "Review and understand our ethical guidelines",
      type: "document",
      category: "HR Documents",
      dueDate: "2025-03-10",
      completed: true,
      completedAt: "2024-03-06T09:00:00Z",
      link: "#",
      icon: Link2,
    },
    {
      id: "3",
      title: "IT Security Training",
      description: "Complete the mandatory security awareness training",
      type: "training",
      category: "IT & Security",
      dueDate: "2025-03-15",
      completed: false,
      link: "#",
      icon: Link2,
    },
    {
      id: "4",
      title: "Project Management Tools",
      description: "Training on company's project management software",
      type: "training",
      category: "Tools & Systems",
      dueDate: "2024-03-20",
      completed: false,
      link: "#",
      icon: Link2,
    },
    {
      id: "5",
      title: "Department Overview",
      description: "Introduction to your department's processes and goals",
      type: "document",
      category: "Department Specific",
      dueDate: "2024-03-12",
      completed: false,
      link: "#",
      icon: Link2,
    },
    {
      id: "6",
      title: "Benefits Enrollment",
      description: "Complete your benefits selection",
      type: "task",
      category: "HR Documents",
      dueDate: "2025-03-3",
      completed: false,
      icon: Link2,
    },
    {
      id: "7",
      title: "Team Introduction Meeting",
      description: "Schedule and attend team introduction meeting",
      type: "task",
      category: "Department Specific",
      dueDate: "2024-03-11",
      completed: true,
      completedAt: "2024-03-07T11:15:00Z",
      icon: Link2,
    },
    {
      id: "8",
      title: "Compliance Training",
      description: "Complete mandatory compliance training modules",
      type: "training",
      category: "Compliance",
      dueDate: "2024-03-18",
      completed: false,
      link: "#",
      icon: Link2,
    },
  ]);

  const toggleCompletion = (itemId) => {
    setOnboardingItems((items) =>
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              completed: !item.completed,
              completedAt: !item.completed
                ? new Date().toISOString()
                : undefined,
            }
          : item
      )
    );
  };

  const calculateProgress = () => {
    const total = onboardingItems.length;
    const completed = onboardingItems.filter((item) => item.completed).length;
    return (completed / total) * 100;
  };

  const getItemIcon = (type) => {
    switch (type) {
      case "document":
        return <FileText className="h-4 w-4" />;
      case "training":
        return <GraduationCap className="h-4 w-4" />;
      case "task":
        return <CheckCircle2 className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const categorizedItems = onboardingItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Onboarding Status</CardTitle>
          <CardDescription>
            Your overall onboarding completion progress
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Overall Progress</span>
            </div>
            <span className="font-medium">
              {Math.round(calculateProgress())}%
            </span>
          </div>
          <Progress value={calculateProgress()} className="h-2" />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  HR Documents
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-blue-500" />
                  <span className="text-2xl font-bold">3/4</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Training</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-green-500" />
                  <span className="text-2xl font-bold">1/3</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Department
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Users2 className="h-4 w-4 text-purple-500" />
                  <span className="text-2xl font-bold">1/2</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Due Soon</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-500" />
                  <span className="text-2xl font-bold">2</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Accordion type="single" collapsible className="w-full border-none">
        {Object.entries(categorizedItems).map(([category, items]) => (
          <AccordionItem
            key={category}
            value={category}
            className="border bg-background px-4 py-1 first:rounded-t-lg last:rounded-b-lg"
          >
            <AccordionPrimitive.Header className="flex">
              <AccordionPrimitive.Trigger className="flex flex-1 items-center justify-between py-2 text-left text-[15px] font-semibold leading-6 transition-all [&>svg>path:last-child]:origin-center [&>svg>path:last-child]:transition-all [&>svg>path:last-child]:duration-200 [&[data-state=open]>svg>path:last-child]:rotate-90 [&[data-state=open]>svg>path:last-child]:opacity-0 [&[data-state=open]>svg]:rotate-180">
                <span className="flex items-center gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border"
                    aria-hidden="true"
                  >
                    {category.split("")[0]}
                  </span>
                  <span className="flex flex-col space-y-1">
                    <span>{category}</span>
                  </span>
                  <Badge variant="outline">
                    {items.filter((item) => item.completed).length}/
                    {items.length}
                  </Badge>
                </span>
                <Plus
                  size={16}
                  strokeWidth={2}
                  className="shrink-0 opacity-60 transition-transform duration-200"
                  aria-hidden="true"
                />
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>
            {/* <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <span>{category}</span>
                <Badge variant="outline">
                  {items.filter((item) => item.completed).length}/{items.length}
                </Badge>
              </div>
            </AccordionTrigger> */}
            <AccordionContent>
              <div className="border pt-4 rounded-xl">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-none shadow-none border-b last:border-none"
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <CardTitle className="text-base">
                            {item.title}
                          </CardTitle>
                          <CardDescription>{item.description}</CardDescription>
                        </div>
                        <Badge
                          variant={getDueDateVariant(item?.dueDate)}
                          className="ml-2"
                        >
                          Due: {format(item.dueDate, "PPP")}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2">
                        {getItemIcon(item.type)}
                        <span className="text-sm text-muted-foreground capitalize">
                          {item.type}
                        </span>
                      </div>
                    </CardContent>
                    <CardFooter className="flex justify-between">
                      {item.link && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-2"
                        >
                          <BookOpen className="h-4 w-4" />
                          View Material
                        </Button>
                      )}
                      <div className="flex items-center gap-4">
                        {item.completedAt && (
                          <span className="text-sm text-muted-foreground">
                            Completed on {format(item.completedAt, "PPP")} at{" "}
                            {format(new Date(item.completedAt), "k:mm b")}
                          </span>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            Mark as complete
                          </span>
                          <Checkbox
                            checked={item.completed}
                            onCheckedChange={() => toggleCompletion(item.id)}
                          />
                        </div>
                      </div>
                    </CardFooter>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
};

function getDueDateVariant(dateString) {
  const differenceInDay = differenceInDays(new Date(dateString), new Date());

  if (differenceInDay < 0) return "destructive";
  if (differenceInDay <= 3) return "secondary";
  return "outline";
}
