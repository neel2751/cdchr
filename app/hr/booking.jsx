"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, MapPin, Heart, CheckCircle } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectItem,
  SelectValue,
  SelectContent,
} from "@/components/ui/select";

// Make api call to backend to for booking consultation

const availableDates = Array.from({ length: 12 }, (_, i) => {
  // we have to remove sundays and countinue to next day
  const date = new Date();
  date.setDate(date.getDate() + i);
  if (date.getDay() === 0) {
    // without duplicate dates
    date.setDate(date.getDate() + 1);
  }
  const options = { month: "short" };
  const dayOptions = { weekday: "short" };

  return {
    day: date.toLocaleDateString("en-GB", dayOptions),
    date: date.getDate(),
    month: date.toLocaleDateString("en-GB", options),
    fullDate: date.toISOString().split("T")[0],
    available: Math.floor(Math.random() * 5) + 1, // Random availability between 1 and 5
  };
});

const removeDuplicates = availableDates.filter(
  (date, index, self) =>
    index ===
    self.findIndex(
      (d) =>
        d.day === date.day && d.date === date.date && d.month === date.month
    )
);

const DesignProcess = ["ASAP", "3-6 months", "6+ months", "I'm not sure"];

const timeSlots = [
  { time: "11:00", available: true },
  { time: "12:00", available: true },
  { time: "13:00", available: true },
  { time: "14:00", available: true },
  { time: "15:00", available: true },
  { time: "16:00", available: true },
  { time: "17:00", available: true },
];

const propertyTypes = [
  {
    id: "detached",
    name: "Detached",
    icon: "https://dwpbnzvyubj62.cloudfront.net/assets/_global/icons/house_types/detached-35970db5460665aed5d931f2b6b2ddd141a7db12a8ed71966872aab630972fe7.svg",
  },
  {
    id: "semi-detached",
    name: "Semi Detached",
    icon: "https://dwpbnzvyubj62.cloudfront.net/assets/_global/icons/house_types/semi_detached-ab62975351739d47dac9f9f1a3bad654fc44cb58fc8fbc1aea27660bd4511823.svg",
  },
  {
    id: "terrace",
    name: "Terrace",
    icon: "https://dwpbnzvyubj62.cloudfront.net/assets/_global/icons/house_types/terrace-3d3f60b8f5d4d65ab59175ed8f260f963c5968be7fbb908c38a70fc47f97cb03.svg",
  },
  {
    id: "flat",
    name: "Flat",
    icon: "https://dwpbnzvyubj62.cloudfront.net/assets/_global/icons/house_types/flat-6006db9ebd0f47d859b01119668609316e6104ed4e069b217baee954e5879409.svg",
  },
  {
    id: "bungalow",
    name: "Bungalow",
    icon: "https://dwpbnzvyubj62.cloudfront.net/assets/_global/icons/house_types/bungalow-12190872d79c088b519c449d90cb0716bb2cbe68a729a5eb283d494adb948758.svg",
  },
];

const discussionTopics = [
  "Budget",
  "Planning",
  "Design",
  "Builders",
  "Timelines",
  "Suppliers",
];

const services = [
  { id: "architectural", name: "Architectural Drawings" },
  { id: "design-planning", name: "Design and planning advice" },
  { id: "financing", name: "Help with financing my build" },
  { id: "builder", name: "Help finding a builder" },
  {
    id: "professionals",
    name: "Help finding other professionals",
    options: [
      "Structural engineer",
      "Party wall surveyor",
      "Building control",
      "Other professionals",
    ],
  },
  { id: "none", name: "No, thank you" },
];

export const ConsultationBooking = () => {
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedProperty, setSelectedProperty] = useState("");
  const [selectedServices, setSelectedServices] = useState([]);
  const [formData, setFormData] = useState({
    address: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    acceptTerms: false,
    subscribeUpdates: false,
  });

  return (
    <div className="min-h-screen bg-[#edebfc] rounded-3xl my-8">
      <section className="py-12 md:py-16 lg:py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-[#3e3068] mb-4 md:mb-6 leading-tight tracking-tighter">
            Book a free 30-minute consultation call with a CDC expert
          </h1>
          <p className="text-base md:text-lg text-[#3e3068] mb-8 md:mb-12 max-w-3xl mx-auto leading-relaxed tracking-tight">
            Whether you’re just starting out or deep into your project, our
            experts are here to help you navigate the complexities of your
            build. From budgeting and planning to design and finding the right
            professionals, we can provide tailored advice to suit your unique
            needs.
          </p>

          <div className="flex items-center justify-center">
            <h3 className="text-lg font-semibold text-[#3e3068]">
              We can discuss...
            </h3>
            <div className="flex flex-wrap justify-center gap-3 md:gap-4 items-center ml-4">
              {discussionTopics.map((topic) => (
                <div key={topic} className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span className="text-[#3e3068] font-medium text-sm">
                    {topic}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 pb-16">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="p-4 md:p-6 lg:p-8">
              {/* Date Selection */}
              <div className="mb-8">
                <h3 className="text-lg tracking-tight font-semibold text-[#3e3068] mb-4 md:mb-6">
                  Select a date
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
                  {removeDuplicates.slice(0, 10).map((date) => (
                    <Button
                      key={date?.fullDate}
                      variant={"outline"}
                      onClick={() => setSelectedDate(date?.fullDate)}
                      data-selected={selectedDate === date?.fullDate}
                      className="relative flex flex-col items-center justify-center h-auto border-2 hover:bg-[#f3f0ff] hover:border-[#3e3068] data-[selected=true]:border-[#3e3068] data-[selected=true]:bg-[#e0d9ff] data-[selected=true]:hover:bg-[#d1c4ff] rounded-lg p-3 md:p-4 cursor-pointer"
                    >
                      <div
                        className={`text-xs ${
                          selectedDate === date?.fullDate
                            ? "text-[#3e3068] font-semibold"
                            : "text-[#3e3068]"
                        }`}
                      >
                        {date?.day}
                      </div>
                      <div className="text-xl md:text-2xl font-bold  text-[#3e3068] leading-none">
                        {date?.date}
                      </div>
                      <div className="text-xs text-[#3e3068]">
                        {date?.month}
                      </div>
                      <div className="text-xs mt-1 text-[#3e3068]">
                        {date?.available} left
                      </div>
                    </Button>
                  ))}
                </div>
              </div>

              {/* Time Selection */}
              {selectedDate && (
                <div className="mb-8">
                  <h3 className="text-lg tracking-tight font-semibold text-[#3e3068] mb-4 md:mb-6">
                    Select a time
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 md:gap-4">
                    {timeSlots.map((slot) => (
                      <Button
                        key={slot.time}
                        variant="outline"
                        data-selected={selectedTime === slot.time}
                        onClick={() => setSelectedTime(slot.time)}
                        className="h-12 md:h-14 border-2 hover:bg-[#f3f0ff] hover:border-[#3e3068] data-[selected=true]:border-[#3e3068] data-[selected=true]:bg-[#e0d9ff] data-[selected=true]:hover:bg-[#d1c4ff] rounded-lg px-3 md:px-4 cursor-pointer flex items-center justify-center"
                      >
                        <span className="text-sm md:text-base">
                          {slot.time}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Property Type Selection */}
              {selectedDate && selectedTime && (
                <div className="mb-8">
                  <h3 className="text-lg tracking-tight font-semibold text-[#3e3068] mb-4 md:mb-6">
                    What sort of property is this?
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
                    {propertyTypes.map((property) => (
                      <Button
                        key={property?.id}
                        variant="outline"
                        data-selected={selectedProperty === property?.id}
                        onClick={() => setSelectedProperty(property?.id)}
                        className="flex flex-col items-center justify-center h-auto border-2 hover:bg-[#f3f0ff] hover:border-[#3e3068] data-[selected=true]:border-[#3e3068] data-[selected=true]:bg-[#e0d9ff] data-[selected=true]:hover:bg-[#d1c4ff] rounded-lg p-3 md:p-4 cursor-pointer"
                      >
                        <div className="mb-2">
                          <img
                            src={property?.icon}
                            alt={property?.name}
                            className="w-10 h-10 md:w-14 md:h-14 mx-auto opacity-70"
                          />
                        </div>
                        <span className="text-sm md:text-base font-medium text-[#3e3068]">
                          {property?.name}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Design Process */}
              {selectedProperty && (
                <div className="mb-8">
                  <h3 className="text-lg tracking-tight font-semibold text-[#3e3068] mb-4 md:mb-6">
                    What stage are you at in your design process?
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                    {DesignProcess.map((stage) => (
                      <Button
                        key={stage}
                        variant="outline"
                        data-selected={formData.designProcess === stage}
                        onClick={() =>
                          setFormData({ ...formData, designProcess: stage })
                        }
                        className="
                        text-[#3e3068]
                        h-12 md:h-14 border-2 hover:bg-[#f3f0ff] hover:border-[#3e3068] data-[selected=true]:border-[#3e3068] data-[selected=true]:bg-[#e0d9ff] data-[selected=true]:hover:bg-[#d1c4ff] rounded-lg px-3 md:px-4 cursor-pointer flex items-center justify-center text-sm md:text-base"
                      >
                        {stage}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Services Selection */}
              {formData.designProcess && (
                <div className="mb-8">
                  <h3 className="text-lg tracking-tight font-semibold text-[#3e3068] mb-4 md:mb-6">
                    Are you interested in any of these services?
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                    {services.map((service) => (
                      <Button
                        key={service.id}
                        variant="outline"
                        data-selected={selectedServices.includes(service.id)}
                        onClick={() => {
                          // what if user clicks on "No, thank you" option then we have to deselect all other options and select only "No, thank you" option
                          if (service.id === "none") {
                            setSelectedServices(["none"]);
                          } else {
                            // if "No, thank you" is selected then we have to deselect it
                            if (selectedServices.includes("none")) {
                              setSelectedServices([service.id]);
                            } else {
                              if (selectedServices.includes(service.id)) {
                                setSelectedServices(
                                  selectedServices.filter(
                                    (s) => s !== service.id
                                  )
                                );
                              } else {
                                setSelectedServices([
                                  ...selectedServices,
                                  service.id,
                                ]);
                              }
                            }
                          }
                        }}
                        className="
                        text-[#3e3068]
                        h-auto min-h-[48px] border-2 hover:bg-[#f3f0ff] hover:border-[#3e3068] data-[selected=true]:border-[#3e3068] data-[selected=true]:bg-[#e0d9ff] data-[selected=true]:hover:bg-[#d1c4ff] rounded-lg px-3 md:px-4 cursor-pointer flex items-center justify-center text-sm md:text-base text-center py-3"
                      >
                        {service.name}
                      </Button>
                    ))}
                  </div>

                  {selectedServices.includes("professionals") && (
                    <div className="mt-8 space-y-2">
                      <h3 className="text-lg tracking-tight font-semibold text-[#3e3068] mb-4 md:mb-6">
                        Please specify which professionals you need help with:
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {services
                          .find((s) => s.id === "professionals")
                          .options.map((option) => (
                            <Button
                              key={option}
                              variant="outline"
                              data-selected={formData.professionals?.includes(
                                option
                              )}
                              onClick={() => {
                                if (formData.professionals?.includes(option)) {
                                  setFormData({
                                    ...formData,
                                    professionals:
                                      formData.professionals.filter(
                                        (p) => p !== option
                                      ),
                                  });
                                } else {
                                  setFormData({
                                    ...formData,
                                    professionals: [
                                      ...(formData.professionals || []),
                                      option,
                                    ],
                                  });
                                }
                              }}
                              className="
                            text-[#3e3068]
                              h-auto min-h-[40px] border-2 hover:bg-[#f3f0ff] hover:border-[#3e3068] data-[selected=true]:border-[#3e3068] data-[selected=true]:bg-[#e0d9ff] data-[selected=true]:hover:bg-[#d1c4ff] rounded-lg px-3 md:px-4 cursor-pointer flex items-center justify-center text-sm md:text-base text-center py-2"
                            >
                              {option}
                            </Button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Other Field */}
                  {selectedServices.includes("professionals") &&
                    formData.professionals?.includes("Other professionals") && (
                      <div className="mt-6">
                        <Label
                          htmlFor="otherProfessional"
                          className="text-sm font-medium mb-2
                          text-[#3e3068]
                          "
                        >
                          Tell us which service you need help with *
                        </Label>
                        <Input
                          id="otherProfessional"
                          className={"w-full h-10 outline-none "}
                          placeholder="Specify other professionals"
                          value={formData.otherProfessional || ""}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              otherProfessional: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                </div>
              )}

              {/* Contact Form */}
              {selectedServices.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-lg tracking-tight font-semibold text-[#3e3068] mb-4 md:mb-6">
                    A few details to confirm your booking
                  </h3>
                  <div className="space-y-4 md:space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="address" className="text-sm font-medium">
                        Address *
                      </Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-4 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="address"
                          placeholder="Enter your address"
                          value={formData.address}
                          className="
                          focus-visible:ring-1 focus-visible:ring-[#3e3068] pl-10 outline-none focus-visible:border-[#3e3068] h-12"
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              address: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label
                          htmlFor="firstName"
                          className="text-sm font-medium"
                        >
                          First name *
                        </Label>
                        <Input
                          id="firstName"
                          placeholder="First name"
                          value={formData.firstName}
                          className={
                            "outline-none focus-visible:ring-1 focus-visible:ring-[#3e3068] focus-visible:border-[#3e3068] h-12"
                          }
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              firstName: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label
                          htmlFor="lastName"
                          className="text-sm font-medium"
                        >
                          Last name *
                        </Label>
                        <Input
                          id="lastName"
                          placeholder="Last name"
                          value={formData.lastName}
                          className={
                            "outline-none focus-visible:ring-1 focus-visible:ring-[#3e3068] focus-visible:border-[#3e3068] h-12"
                          }
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              lastName: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-sm font-medium">
                          Email *
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="your@email.com"
                          className={
                            "outline-none focus-visible:ring-1 focus-visible:ring-[#3e3068] focus-visible:border-[#3e3068] h-12"
                          }
                          value={formData.email}
                          onChange={(e) =>
                            setFormData({ ...formData, email: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="text-sm font-medium">
                          Phone *
                        </Label>
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="Phone number"
                          className={
                            "outline-none focus-visible:ring-1 focus-visible:ring-[#3e3068] focus-visible:border-[#3e3068] h-12"
                          }
                          value={formData.phone}
                          onChange={(e) =>
                            setFormData({ ...formData, phone: e.target.value })
                          }
                        />
                      </div>

                      {/* Where did you hear about us? */}
                      <div>
                        <Label
                          htmlFor="hearAbout"
                          className="text-sm font-medium"
                        >
                          Where did you hear about us?
                        </Label>
                        <Select
                          name="hearAbout"
                          id="hearAbout"
                          value={formData.hearAbout || ""}
                          onValueChange={(value) =>
                            setFormData({ ...formData, hearAbout: value })
                          }
                        >
                          <SelectTrigger className=" outline-none focus-visible:ring-1 focus-visible:ring-[#3e3068] focus-visible:border-[#3e3068]">
                            <SelectValue
                              id="hearAbout"
                              className="outline-none h-12"
                              placeholder="Select an option"
                            >
                              {formData.hearAbout
                                ? formData.hearAbout
                                : "Select an option"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {[
                              "Google",
                              "Facebook",
                              "Instagram",
                              "YouTube",
                              "LinkedIn",
                              "Twitter",
                              "Word of mouth",
                              "Tv advert",
                              "Advertising board",
                              "Other",
                            ].map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="md:col-span-2 space-y-2">
                        <Label
                          htmlFor="subscribeUpdates"
                          className="text-sm font-medium"
                        >
                          Would you like to receive updates and news from CDC?
                        </Label>
                        <div className="flex items-start space-x-3">
                          <Checkbox
                            id="subscribeUpdates"
                            checked={formData.subscribeUpdates}
                            onCheckedChange={(checked) =>
                              setFormData({
                                ...formData,
                                subscribeUpdates: checked,
                              })
                            }
                            className="mt-1"
                          />
                          <Label
                            htmlFor="subscribeUpdates"
                            className="text-sm leading-relaxed cursor-pointer"
                          >
                            Yes, sign me up to receive updates and news from
                            CDC. I can unsubscribe at any time.
                          </Label>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-start space-x-3">
                        <Checkbox
                          id="acceptTerms"
                          checked={formData.acceptTerms}
                          onCheckedChange={(checked) =>
                            setFormData({ ...formData, acceptTerms: checked })
                          }
                          className="mt-1"
                        />
                        <Label
                          htmlFor="acceptTerms"
                          className="text-sm leading-relaxed cursor-pointer"
                        >
                          I accept the{" "}
                          <a href="#" className="text-primary hover:underline">
                            terms and conditions
                          </a>
                        </Label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              {formData.acceptTerms &&
                formData.address &&
                formData.firstName &&
                formData.lastName &&
                formData.email &&
                formData.phone && (
                  <div className="flex justify-center pt-6">
                    <Button
                      variant="default"
                      size="lg"
                      className="px-8 w-full md:w-auto"
                    >
                      Book advice call
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
};
