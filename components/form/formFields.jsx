import { forwardRef, memo, useState } from "react";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { cn } from "@/lib/utils";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { CalendarIcon, Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { useController } from "react-hook-form";
import { Calendar } from "../ui/calendar";
import { format, getMonth, getYear, setMonth, setYear } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Checkbox } from "../ui/checkbox";

export const TextFormInput = memo(
  forwardRef(function TextFormInput(
    {
      labelText,
      className,
      type,
      placeholder,
      value,
      disabled,
      errorMsg,
      helperText,
      ...prop
    },
    ref
  ) {
    return (
      // <div className="relative">

      <div>
        {labelText && (
          <Label
            className="text-sm font-medium text-neutral-500"
            htmlFor={labelText}
          >
            {labelText}
          </Label>
        )}
        <div className="flex flex-col mt-1">
          <Input
            {...prop}
            // id={formid}
            id={labelText}
            ref={ref}
            type={type}
            placeholder={placeholder || ""}
            value={value && value}
            autoComplete="off"
            disabled={disabled}
          />
          <p className="mt-1.5 text-[12px] text-stone-500">{helperText}</p>
          {errorMsg && (
            <p className="text-red-600 text-sm mt-1 ml-2" role="alert">
              {errorMsg}
            </p>
          )}
        </div>
      </div>
    );
  })
);

export const TextAreaFormInput = memo(
  forwardRef(function TextFormInput(
    {
      labelText,
      className,
      type,
      placeholder,
      value,
      disabled,
      errorMsg,
      helperText,
      ...prop
    },
    ref
  ) {
    return (
      // <div className="relative">

      <div>
        {labelText && (
          <Label
            className="text-sm font-medium text-neutral-500"
            htmlFor={labelText}
          >
            {labelText}
          </Label>
        )}
        <div className="flex flex-col mt-1">
          <Textarea
            {...prop}
            // id={formid}
            id={labelText}
            ref={ref}
            type={type}
            className={cn(
              "py-3 px-4 block w-full border text-neutral-800 border-gray-200 rounded-lg text-sm  disabled:opacity-50 disabled:pointer-events-none outline-none",
              className
            )}
            placeholder={placeholder || ""}
            value={value && value}
            autoComplete="off"
            disabled={disabled}
          />
          <p className="mt-1.5 text-[12px] text-stone-500">{helperText}</p>
          {errorMsg && (
            <p className="text-red-600 text-sm mt-1 ml-2" role="alert">
              {errorMsg}
            </p>
          )}
        </div>
      </div>
    );
  })
);

export const SearchSelect = memo(
  forwardRef(function SearchSelect(
    {
      name,
      control,
      options = [],
      rules,
      labelText,
      helperText,
      placeholder = "Select option...",
      className,
      onChange,
      onBlur,
      errorMsg,
      value: propValue,
      ...rest
    },
    ref
  ) {
    const [open, setOpen] = useState(false);
    const [searchValue, setSearchValue] = useState("");
    const {
      field: {
        onChange: controllerOnChange,
        onBlur: controllerOnBlur,
        value = "",
        ref: controllerRef,
      },
    } = useController({
      name,
      control,
      defaultValue: propValue || "",
      rules: rules,
    });

    const handleSelect = (selectedValue) => {
      const newValue = selectedValue === value ? "" : selectedValue;
      controllerOnChange?.(newValue); // updates react-hook-form state
      onChange?.(newValue); // calls any custom onChange handler
      setSearchValue(newValue); // updates local state for controlled component
      setOpen(false);
    };

    return (
      <>
        {labelText && (
          <Label
            className="text-sm font-medium text-neutral-500"
            htmlFor={labelText}
          >
            {labelText}
          </Label>
        )}
        <div className="mt-1">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                // role="combobox"
                aria-expanded={open}
                className={`w-full justify-between ${
                  value ? "text-neutral-900" : "text-neutral-500"
                }`}
              >
                {value
                  ? options.find((framework) => framework.value === value)
                      ?.label
                  : placeholder}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0">
              <Command
                filter={(value, search) => {
                  const item = options.find((item) => item.value === value);
                  if (!item) return 0;
                  if (item.label.toLowerCase().includes(search.toLowerCase()))
                    return 1;

                  return 0;
                }}
              >
                <CommandInput
                  placeholder={placeholder ? placeholder : "Search..."}
                />
                <CommandList>
                  <CommandEmpty>{"No Data found."}</CommandEmpty>
                  {/* <ScrollArea className="h-72"> */}
                  <CommandGroup>
                    {options &&
                      options?.map((framework) => (
                        <CommandItem
                          key={framework.value}
                          value={framework.value}
                          onSelect={(currentValue) => {
                            handleSelect(currentValue);
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              value === framework.value
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          {framework.label}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                  {/* </ScrollArea> */}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {helperText && (
            <p className="mt-1.5 text-[12px] text-stone-500">{helperText}</p>
          )}
          {errorMsg && (
            <p className="text-red-600 text-sm ml-2 mt-2">{errorMsg}</p>
          )}
        </div>
      </>
    );
  })
);

export const DateSelect = memo(
  forwardRef(function DateSelect(
    {
      name,
      control,
      rules,
      labelText,
      helperText,
      placeholder = "Select option...",
      className,
      onChange,
      onBlur,
      errorMsg,
      value: propValue,
      ...rest
    },
    ref
  ) {
    const startYear = getYear(new Date()) - 100;
    const endYear = getYear(new Date()) + 100;

    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const years = Array.from(
      { length: endYear - startYear + 1 },
      (_, i) => startYear + i
    );

    const {
      field: {
        onChange: controllerOnChange,
        onBlur: controllerOnBlur,
        value = "",
        ref: controllerRef,
      },
    } = useController({
      name,
      control,
      defaultValue: propValue || new Date(),
      rules: rules,
    });

    const handleMonth = (month) => {
      const newDate = setMonth(value, months.indexOf(month));
      controllerOnChange?.(newDate);
    };

    const handleYear = (year) => {
      const newDate = setYear(value, parseInt(year));
      controllerOnChange?.(newDate);
    };

    return (
      <>
        {labelText && (
          <Label
            className="text-sm font-medium text-neutral-500"
            htmlFor={labelText}
          >
            {labelText}
          </Label>
        )}
        <div className="mt-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className={cn(
                  "w-full pl-3 text-left font-normal",
                  !value && "text-muted-foreground"
                )}
              >
                {value ? format(value, "PPP") : <span>Pick a date</span>}
                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="flex w-auto flex-col space-y-2 p-2 ">
              {/* <Select
                onValueChange={(value) =>
                  controllerOnChange?.(addDays(new Date(), parseInt(value)))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="0">Today</SelectItem>
                  <SelectItem value="1">Tomorrow</SelectItem>
                  <SelectItem value="3">In 3 days</SelectItem>
                  <SelectItem value="7">In a week</SelectItem>
                  <SelectItem value="30">In a Month</SelectItem>
                </SelectContent>
              </Select> */}
              <div className="flex gap-2 justify-center">
                <Select
                  onValueChange={handleMonth}
                  value={months[getMonth(value)]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((month) => (
                      <SelectItem value={month} key={month}>
                        {month}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  onValueChange={handleYear}
                  value={getYear(value).toString()}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((year) => (
                      <SelectItem value={year.toString()} key={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Calendar
                mode="single"
                selected={value}
                onSelect={(val) => controllerOnChange?.(val)}
                month={value}
                onMonthChange={controllerOnChange}
                // numberOfMonths={2}
                // disabled={(date) =>
                //   date > new Date() || date < new Date("1900-01-01")
                // }
                initialFocus
              />
            </PopoverContent>
          </Popover>
          {helperText && (
            <p className="mt-1.5 text-[12px] text-stone-500">{helperText}</p>
          )}
          {errorMsg && (
            <p className="text-red-600 text-sm ml-2 mt-2">{errorMsg}</p>
          )}
        </div>
      </>
    );
  })
);

export const RadioForm = memo(
  forwardRef(function RadioForm(
    {
      name,
      control,
      rules,
      labelText,
      helperText,
      placeholder = "Select option...",
      className,
      onChange,
      onBlur,
      options,
      errorMsg,
      value: propValue,
      ...rest
    },
    ref
  ) {
    const {
      field: {
        onChange: controllerOnChange,
        onBlur: controllerOnBlur,
        value = propValue,
        ref: controllerRef,
      },
    } = useController({
      name,
      control,
      defaultValue: propValue || "",
      rules: rules,
    });

    return (
      <>
        {labelText && (
          <Label
            className="text-sm font-medium text-neutral-500"
            htmlFor={labelText}
          >
            {labelText}
          </Label>
        )}
        <div className={`${className} border mt-1 rounded-md p-2.5 shadow-sm`}>
          <RadioGroup onValueChange={controllerOnChange} value={value}>
            <div className="flex items-center space-x-8">
              {options.map((item, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <RadioGroupItem value={item?.value} id={item?.value} />
                  <Label className="text-neutral-600" htmlFor={item?.value}>
                    {item?.label}
                  </Label>
                </div>
              ))}
            </div>
          </RadioGroup>
        </div>
        {helperText && (
          <p className="mt-1.5 text-[12px] text-stone-500">{helperText}</p>
        )}
        {errorMsg && (
          <p className="text-red-600 text-xs ml-1 mt-2">{errorMsg}</p>
        )}
      </>
    );
  })
);

export const CheckBoxForm = memo(
  forwardRef(function CheckBoxForm(
    {
      name,
      control,
      rules,
      labelText,
      helperText,
      placeholder = " Select an option",
      className,
      errorMsg,
      value: propValue,
    },
    ref
  ) {
    const {
      field: { onChange: controllerOnChange, value = propValue },
    } = useController({
      name,
      control,
      defaultValue: propValue || "",
      rules: rules,
    });
    return (
      <>
        {labelText && (
          <Label
            className="text-sm font-medium text-neutral-500"
            htmlFor={labelText}
          >
            {labelText}
          </Label>
        )}
        <div
          className={`${className} border mt-1 rounded-md p-2.5 shadow-sm flex items-center gap-2 text-ellipsis`}
        >
          <Checkbox checked={value} onCheckedChange={controllerOnChange} />
          <p className="text-sm text-neutral-500">{placeholder}</p>
        </div>
        {helperText && (
          <p className="mt-1.5 text-[12px] text-stone-500">{helperText}</p>
        )}
        {errorMsg && (
          <p className="text-red-600 text-xs ml-1 mt-2">{errorMsg}</p>
        )}
      </>
    );
  })
);

export const CheckBoxNormal = ({ isChecked, setIsChecked }) => {
  const handleOnChange = () => {
    setIsChecked(!isChecked);
  };

  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id="terms"
        checked={isChecked}
        onCheckedChange={handleOnChange}
      />
      <Label htmlFor="terms" className="text-neutral-600 font-normal">
        {/*  we have to say that this is change in all old attendance data */}
        If you want Update all old attendance data (will be take few minutes)
        {/* Accept terms and conditions */}
      </Label>
    </div>
  );
};

export const DatePickerWithRange = memo(
  forwardRef(function DatePickerWithRange(
    { date, setDate, label, helperText, errorMsg, className, ...props },
    ref
  ) {
    return (
      <div className={cn("grid gap-2", className)}>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="date"
              variant={"outline"}
              className={cn(
                "w-[300px] max-w-max justify-start text-left font-normal",
                !date && "text-muted-foreground"
              )}
            >
              <CalendarIcon />
              {date?.from ? (
                date.to ? (
                  <>
                    {format(date.from, "LLL dd, y")} -{" "}
                    {format(date.to, "LLL dd, y")}
                  </>
                ) : (
                  format(date.from, "LLL dd, y")
                )
              ) : (
                <span>Pick a date</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={setDate}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  })
);
