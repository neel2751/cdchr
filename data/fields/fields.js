import { COUNTRIES } from "../countries";
import { MENU } from "../menu";

export const PATTERN = {
  pattern: {
    value: /^(?! )[a-zA-Z0-9]+(?: [a-zA-Z0-9]+)*(?<! )$/,
    message: "Invalid format",
  },
};

export const EMERGENCYFIELD = [
  {
    name: "emergencyName",
    labelText: "Emergency Name",
    type: "text",
    placeholder: "Enter Emergency Name",
    validationOptions: {
      required: "Emergency Name is required",
      minLength: {
        value: 3,
        message: "Minimum 3 characters required",
      },
      maxLength: {
        value: 20,
        message: "Maximum 20 characters allowed",
      },
      ...PATTERN,
    },
  },
  {
    name: "emergencyRelation",
    labelText: "Emergency Relation",
    type: "text",
    placeholder: "Enter Emergency Relation",
    validationOptions: {
      required: "Emergency Relation is required",
      minLength: {
        value: 3,
        message: "Minimum 3 characters required",
      },
      maxLength: {
        value: 20,
        message: "Maximum 20 characters allowed",
      },
      ...PATTERN,
    },
  },
  {
    name: "emergencyPhoneNumber",
    labelText: "Emergency Number",
    type: "number",
    inputMode: "numeric",
    placeholder: "Emergency Number",
    validationOptions: {
      required: "Phone No. is required",
      pattern: {
        value: /^\d{10}$/,
        message: "Invalid phone number. Must be exactly 10 digits.",
      },
    },
  },
  {
    name: "emergencyAddress",
    labelText: "Emergency Address",
    type: "text",
    placeholder: "Enter Emergency Address",
    validationOptions: {
      required: "Emergency Address is required",
      minLength: {
        value: 3,
        message: "Minimum 3 characters required",
      },
      maxLength: {
        value: 50,
        message: "Maximum 50 characters allowed",
      },
      ...PATTERN,
    },
  },
];

export const VISAFIELD = [
  {
    name: "immigrationType",
    labelText: " Immigration Type",
    type: "select",
    placeholder: "Enter Immigration Type",
    options: [
      { value: "British", label: "British" },
      { value: "Immigrant", label: "Immigrant" },
    ],
    validationOptions: {
      required: "Immigration Type is required",
    },
  },
  {
    name: "immigrationCategory",
    labelText: " Immigration  Category",
    type: "text",
    showIf: {
      field: "immigrationType",
      value: "Immigrant",
    },
    // size: true,
    placeholder: "Enter Immigration  Category",
    validationOptions: {
      required: "Immigration  Category is required",
      minLength: {
        value: 3,
        message: "Minimum length should be 3 characters",
      },
      pattern: {
        value: /^(?! )[a-zA-Z0-9]+(?: [a-zA-Z0-9]+)*(?<! )$/,
        message: "Invalid immigration status format",
      },
    },
  },
  {
    name: "joinDate",
    labelText: "Join Date",
    type: "date",
    value: new Date(),
    placeholder: "Start Date",
    validationOptions: {
      required: "Join Date is required",
    },
  },
  {
    name: "endDate",
    labelText: "End Date",
    type: "date",
    placeholder: "End Date",
  },
  {
    name: "visaStartDate",
    labelText: "Visa Start Date",
    type: "date",
    showIf: {
      field: "immigrationType",
      value: "Immigrant",
    },
    placeholder: "Select Date",
    validationOptions: {
      required: "Visa Start Date is required",
    },
  },
  {
    name: "visaEndDate",
    labelText: "Visa End Date",
    type: "date",
    showIf: {
      field: "immigrationType",
      value: "Immigrant",
    },
    placeholder: "Visa End Date",
    validationOptions: {
      required: "Visa End Date is required",
    },
  },
];

export const DEPARTMENTFIELD = [
  {
    name: "department",
    labelText: "Role Department",
    options: [],
    type: "select",
    validationOptions: { required: "Role Department is required" },
  },
  {
    name: "roleType",
    labelText: "Role Type",
    type: "text",
    placeholder: "operation, office,business...",
    validationOptions: {
      required: "Role Type is required",
      ...PATTERN,
    },
  },
  {
    name: "company",
    labelText: "Company",
    type: "select",
    options: [],
    placeholder: "Select  a company",
    validationOptions: {
      required: "Company is required",
    },
  },
];

export const EMPLOYEFIELD = [
  // {
  //   name: "profileImage",
  //   labelText: "Profile Image",
  //   type: "image",
  //   placeholder: "Upload Profile Image",
  //   acceptedFileTypes: { "image/*": [".png", ".jpg", ".jpeg"] },
  //   maxFileSize: 1024 * 1024 * 5,
  //   maxFiles: 1,
  //   size: true,
  //   validationOptions: {
  //     required: "Profile Image is required",
  //   },
  // },
  {
    name: "firstName",
    labelText: "First Name",
    type: "text",
    placeholder: "Enter First Name",
    validationOptions: {
      required: "First name is required",
      minLength: {
        value: 3,
        message: "Minimum 3 characters required",
      },
      maxLength: {
        value: 20,
        message: "Maximum 20 characters allowed",
      },
      ...PATTERN,
    },
  },
  {
    name: "lastName",
    labelText: "Last Name",
    type: "text",
    placeholder: "Enter Last Name",
    validationOptions: {
      required: "Last name is required",
      minLength: {
        value: 3,
        message: "Minimum 3 characters required",
      },
      maxLength: {
        value: 20,
        message: "Maximum 20 characters allowed",
      },
      ...PATTERN,
    },
  },
  {
    name: "email",
    labelText: "Email Address",
    type: "email",
    helperText: "*Please enter a valid email address.",
    placeholder: "Enter your email",
    validationOptions: {
      required: "Email is required",
      pattern: {
        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
        message: "Invalid email format. Please check and try again.",
      },
    },
  },
  {
    name: "phone",
    labelText: "Phone Number",
    type: "number",
    inputMode: "numeric",
    placeholder: "Enter Phone Number",
    validationOptions: {
      required: "Phone No. is required",
      pattern: {
        value: /^\d{10}$/,
        message: "Invalid phone number. Must be exactly 10 digits.",
      },
    },
  },
  {
    name: "address",
    labelText: "Address",
    type: "text",
    placeholder: "Apt, Syuite, Building",
    validationOptions: {
      required: "Address is required",
      minLength: {
        value: 5,
        message: "Minimum 5 characters required",
      },
      maxLength: {
        value: 50,
        message: "Maximum 50 characters allowed",
      },
      ...PATTERN,
    },
  },
  {
    name: "streetAddress",
    labelText: "Street Address(optional)",
    type: "text",
    placeholder: "Street Address(optional)",
    validationOptions: {
      ...PATTERN,
    },
  },
  {
    name: "city",
    labelText: "City",
    type: "text",
    placeholder: "city",
    validationOptions: {
      required: "city is required",
      minLength: {
        value: 3,
        message: "Minimum 3 characters required",
      },
      maxLength: {
        value: 20,
        message: "Maximum 20 characters allowed",
      },
      ...PATTERN,
    },
  },
  {
    name: "zipCode",
    labelText: "Zipcode",
    type: "text",
    placeholder: "Zip/Postal Code",
    validationOptions: {
      required: "zipcode is required",
      ...PATTERN,
    },
  },
  {
    name: "country",
    labelText: "Country",
    options: COUNTRIES,
    type: "select",
    validationOptions: { required: "Country is required" },
  },
  {
    name: "paymentType",
    labelText: "Employe Type",
    options: [
      { label: "Monthly", value: "Monthly" },
      { label: "Weekly", value: "Weekly" },
    ],
    // defaultValue: "Monthly",
    type: "radio",
    validationOptions: { required: "Employee Type is required" },
  },
  {
    name: "accountName",
    labelText: "Account Name",
    type: "text",
    placeholder: "Enter Account Name",
    size: true,
    validationOptions: {
      required: "Account name is required",
      minLength: {
        value: 3,
        message: "Minimum 3 characters required",
      },
      maxLength: {
        value: 20,
        message: "Maximum 20 characters allowed",
      },
      ...PATTERN,
    },
  },
  {
    name: "accountNumber",
    labelText: "Account Number",
    type: "number",
    inputMode: "numeric",
    placeholder: "Enter Account Number",
    validationOptions: {
      required: "Account number is required",
      pattern: {
        value: /^\d{8}$/i,
        message: "Must be exactly 8 digits",
      },
    },
  },
  {
    name: "sortCode",
    labelText: "Sort Code",
    type: "number",
    inputMode: "numeric",
    placeholder: "Enter Sort Code",
    validationOptions: {
      required: "Sort code is required",
      pattern: {
        value: /^\d{6}$/i,
        message: "Must be exactly 6 digits",
      },
    },
  },
  {
    name: "utr",
    labelText: " UTR",
    type: "number",
    inputMode: "numeric",
    placeholder: "Enter UTR number",
    showIf: {
      field: "paymentType",
      value: "Weekly",
    },
    validationOptions: {
      required: "UTR number is required",
      pattern: {
        // extact  10 digits
        value: /^\d{10}$/i,
        message: "Must be exactly 10 digits",
      },
    },
  },
  {
    name: "payRate",
    labelText: "Pay Rate",
    type: "text",
    inputMode: "numeric",
    placeholder: "Enter Pay Rate",
    validationOptions: {
      required: "Pay rate is required",
      pattern: {
        // first 3 digit decimal two  places is optional
        value: /^\d{1,2}(\.\d{1,2})?$/,
        message: "Must be a number with optional decimal places",
        //   value: /^\d{1,2}\.\d{2}$/i,
        //   value: /^\d+(\.\d{1,2})?$/i,
      },
    },
  },
  {
    name: "employeNI",
    labelText: "Employee NI",
    type: "text",
    placeholder: " Enter Employee NI",
    validationOptions: {
      required: " Employee NI is required",
      pattern: {
        // capital  letters and numbers only nine  digits
        value: /^[A-Z]{2}\d{6}[A-Z]$/i,
        message: "Must be in the format XX123456X",
        //   value: /^\d{9}[A-Z]{3}$/i,
        //   value: /^[0-9]{6}[0-9A-Z]{4}[0-9A-Z]$/i,
      },
    },
  },
  {
    name: "employeRole",
    labelText: "Employee Role",
    type: "text",
    placeholder: "Enter Employee Role",
    validationOptions: {
      required: "Employee Role is required",
      minLength: {
        value: 3,
        message: "Minimum length should be 3 characters",
      },
      maxLength: {
        value: 20,
        message: "Maximum length should be 20 characters",
      },
      ...PATTERN,
    },
  },
  // {
  //   name: "immigrationStatus",
  //   labelText: " Immigration Status",
  //   type: "text",
  //   placeholder: "Enter Immigration Status",
  //   validationOptions: {
  //     required: "Immigration Status is required",
  //     minLength: {
  //       value: 3,
  //       message: "Minimum length should be 3 characters",
  //     },
  //     pattern: {
  //       value: /^(?! )[a-zA-Z0-9]+(?: [a-zA-Z0-9]+)*(?<! )$/,
  //       message: "Invalid immigration status format",
  //     },
  //   },
  // },

  {
    name: "immigrationType",
    labelText: " Immigration Type",
    type: "select",
    placeholder: "Enter Immigration Type",
    options: [
      { value: "British", label: "British" },
      { value: "Immigrant", label: "Immigrant" },
    ],
    validationOptions: {
      required: "Immigration Type is required",
    },
  },

  {
    name: "immigrationCategory",
    labelText: " Immigration  Category",
    type: "text",
    showIf: {
      field: "immigrationType",
      value: "Immigrant",
    },
    placeholder: "Enter Immigration  Category",
    validationOptions: {
      required: "Immigration  Category is required",
      minLength: {
        value: 3,
        message: "Minimum length should be 3 characters",
      },
      ...PATTERN,
    },
  },

  {
    name: "projectSite",
    labelText: "Project Site",
    options: [],
    type: "select",
    placeholder: "Select Project Site",
    validationOptions: { required: " Project Site is required" },
  },
  //   {
  //     name: "oldData",
  //     type: "checkbox",
  //     labelText: "Old Data",
  //     placeholder: "If you want Update all old attendance",
  //   },
  {
    name: "startDate",
    labelText: "Join Date",
    type: "date",
    value: new Date(),
    placeholder: "Join Date",
    validationOptions: {
      required: "Join Date is required",
    },
  },
  {
    name: "endDate",
    labelText: "End Date",
    type: "date",
    placeholder: "End Date",
  },
  {
    name: "visaStartDate",
    labelText: "Visa Start Date",
    type: "date",
    showIf: {
      field: "immigrationType",
      value: "Immigrant",
    },
    placeholder: "Visa Start Date",
    validationOptions: {
      required: "Visa Start Date is required",
    },
  },
  {
    name: "eVisaExp",
    labelText: " Visa  Expiry Date",
    type: "date",
    showIf: {
      field: "immigrationType",
      value: "Immigrant",
    },
    placeholder: "Visa End Date",
    validationOptions: {
      required: " Visa Expiry Date is required",
    },
  },
  ...EMERGENCYFIELD,
];

export const SITEFIELD = [
  {
    name: "siteName",
    labelText: "Site Name",
    type: "text",
    helperText: "*This Name will appear be on Site Project.",
    placeholder: "Enter your Site Name",
    validationOptions: {
      required: "This Site Name is required",
      minLength: {
        value: 3,
        message: "This Site Name at least 3 character",
      },
      maxLength: {
        value: 50,
        message: "This Site Name at most 50 character",
      },
      ...PATTERN,
    },
  },
  {
    name: "siteAddress",
    labelText: "Site Address",
    type: "text",
    placeholder: "Enter Site address",
    validationOptions: {
      required: "Site Address is required",
      minLength: {
        value: 3,
        message: "Site Address at least 3 character",
      },
      maxLength: {
        value: 50,
        message: "Site Address at most 50 character",
      },
      ...PATTERN,
    },
  },
  {
    name: "status",
    labelText: "Site Status",
    type: "select",
    options: [
      { value: "Active", label: "Active" },
      { value: "On Hold", label: "On Hold" },
      { value: "Completed", label: "Completed" },
      { value: "No Status", label: "No Status" },
    ],
    validationOptions: { required: "Site Status is required" },
  },
  {
    name: "siteType",
    labelText: "Site Type",
    type: "select",
    options: [
      { value: "Residential", label: "Residential" },
      { value: "Commercial", label: "Commercial" },
      { value: "Industrial", label: "Industrial" },
      { value: "Other", label: "Other" },
    ],
    validationOptions: { required: "Site Type is required" },
  },
  {
    name: "startDate",
    labelText: "Start Date",
    type: "date",
    placeholder: "Start Date",
    validationOptions: {
      required: "Start Date is required",
    },
  },
  {
    name: "endDate",
    labelText: "End Date",
    type: "date",
    placeholder: "site end date",
    validationOptions: {
      required: "End Date is required",
    },
  },
  {
    name: "siteDescription",
    labelText: "Site Description",
    size: true,
    type: "textarea",
    helperText: "*Describe the Site Project",
    placeholder: "On this site we will be doing like loft conversion...",
    validationOptions: {
      ...PATTERN,
    },
  },
];

export const OFFICEFIELD = [
  {
    name: "name",
    labelText: "Full Name",
    type: "text",
    helperText: "*This Name will appear be on Site Project.",
    size: true,
    placeholder: "Enter Employee Name",
    validationOptions: {
      required: "Name is required",
      minLength: {
        value: 3,
        message: "Name at least 3 characters",
      },
      maxLength: {
        value: 20,
        message: "Name should not exceed 20 characters",
      },
      ...PATTERN,
    },
  },
  {
    name: "phoneNumber",
    labelText: "Phone Number",
    type: "number",
    inputMode: "numeric",
    placeholder: "Enter Employee Phone Number",
    validationOptions: {
      required: "Phone No. is required",
      pattern: {
        value: /^\d{10}$/,
        message: "Invalid phone number. Must be exactly 10 digits.",
      },
    },
  },
  {
    name: "email",
    labelText: "Email Address",
    type: "email",
    helperText: "*Please enter a valid email address.",
    placeholder: "Enter your email",
    inputMode: "email",
    validationOptions: {
      required: "Email is required",
      pattern: {
        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
        message: "Invalid email format. Please check and try again.",
      },
    },
  },
  ...DEPARTMENTFIELD,
  {
    name: "employeType",
    labelText: "Employe Type",
    type: "select",
    placeholder: "Select Employee Type",
    options: [
      { value: "Full-Time", label: "Full-Time" },
      { value: "Part-Time", label: "Part-Time" },
      // { value: "Irregular-Hours", label: "Irregular-Hours" },
      // { value: "Part-Year", label: "Part-Year" },
    ],
    validationOptions: {
      required: "Employe Type is required",
    },
  },
  {
    name: "dayPerWeek",
    labelText: "Days",
    type: "text",
    pattern: /d*/,
    inputMode: "numeric",
    placeholder: "Enter Days",
    validationOptions: {
      required: "Days is required",
      pattern: {
        // we can't allow to decimal values with not allow zero start with one
        // value: /^[1-7]$/,
        value: /^(?:[1-6](?:\.5)?|7)$/,
        message: "Days should be between 1 and 7",
      },
    },
  },
  {
    name: "hoursPerWeek",
    labelText: "Hours Per Week",
    showIf: {
      field: "employeType",
      value: "Irregular-Hours",
    },
    type: "number",
    placeholder: "Enter Hours Per Week",
    validationOptions: {
      required: "Hours Per Week is required",
      pattern: {
        // we can't allow to decimal values with not allow zero start with one
        value: /^(?!0$)(?:[1-4]?\d|50)$/,
        message: "Please enter a valid number",
      },
      minLength: {
        value: 1,
        message: "Please enter a valid number",
      },
      maxLength: {
        value: 2,
        message: "Please enter a valid number",
      },
    },
  },
  {
    name: "weeksPerYear",
    labelText: "Weeks Per Year",
    showIf: {
      field: "employeType",
      value: "Part-Year",
    },
    type: "number",
    placeholder: " Enter Weeks Per Year",
    validationOptions: {
      required: " Weeks Per Year is required",
      pattern: {
        // we can't allow to decimal values with not allow zero start with one
        value: /^(?!0$)(?:[1-4]?\d|50)$/,
        message: "Please enter a valid number",
      },
      minLength: {
        value: 1,
        message: "Please enter a valid number",
      },
      maxLength: {
        value: 2,
        message: "Please enter a valid number",
      },
    },
  },
  {
    name: "employeNI",
    labelText: "Employee NI",
    type: "text",
    placeholder: " Enter Employee NI",
    validationOptions: {
      required: " Employee NI is required",
      pattern: {
        // capital  letters and numbers only nine  digits
        value: /^[A-Z]{2}\d{6}[A-Z]$/i,
        message: "Must be in the format XX123456X",
        //   value: /^\d{9}[A-Z]{3}$/i,
        //   value: /^[0-9]{6}[0-9A-Z]{4}[0-9A-Z]$/i,
      },
    },
  },
  // {
  //   name: "password",
  //   labelText: "Password",
  //   type: "password",
  //   placeholder: "******",
  //   helperText:
  //     "*if  you want to change password, please enter New password, OtherWise leave as it is",
  //   size: true,
  //   validationOptions: {
  //     required: "password is required",
  //     minLength: {
  //       value: 6,
  //       message: "Minimum length should be 6 characters",
  //     },
  //   },
  // },
  ...VISAFIELD,
  ...EMERGENCYFIELD,
];

export const ASSIGNSITEMANAGERFIELD = [
  {
    name: "roleId",
    labelText: "Employe Name",
    options: [],
    type: "select",
    selectLable: "Search Name",
    validationOptions: { required: "Employee Name is required" },
  },
  {
    name: "projectSiteID",
    labelText: "Site Name",
    options: [],
    type: "select",
    selectLable: "Search site",
    validationOptions: { required: "Site Name is required" },
  },
  {
    name: "startDate",
    labelText: "Start Date",
    type: "date",
    placeholder: "Start Date",
    validationOptions: {
      required: "Start Date is required",
    },
  },
  {
    name: "endDate",
    labelText: "End Date",
    type: "date",
    placeholder: "End Date",
    validationOptions: {
      required: "End Date is required",
    },
  },
];

export const ROLETYPEFIELD = [
  {
    name: "roleTitle",
    labelText: "Department Name",
    type: "text",
    helperText: "*This Name will appear be on Site Project.",
    placeholder: "Department Name",
    size: true,
    validationOptions: {
      required: "Department Name is required",
      minLength: {
        value: 3,
        message: "Department Name must be at least 3 characters long",
      },
      maxLength: {
        value: 20,
        message: "Department Name cannot be more than 20 characters long",
      },
      ...PATTERN,
    },
  },
  {
    name: "roleDescription",
    labelText: "Department Description",
    size: true,
    type: "textarea",
    helperText: "*Describe Departments",
    placeholder:
      "prepare financial statements, business plans and budget reports",
  },
];

export const COMPANYFIELD = [
  // {
  //   name: "profileImage",
  //   labelText: "Profile Image",
  //   type: "image",
  //   placeholder: "Upload Profile Image",
  //   acceptedFileTypes: { "image/*": [".png", ".jpg", ".jpeg"] },
  //   maxFileSize: 1024 * 1024 * 5,
  //   maxFiles: 1,
  //   size: true,
  //   validationOptions: {
  //     required: "Profile Image is required",
  //   },
  // },
  {
    name: "name",
    labelText: "Company Name",
    type: "text",
    helperText: "*This Name will appear be on employee table.",
    placeholder: "Enter Company Name",
    size: true,
    validationOptions: {
      required: " Company Name is required",
      minLength: {
        value: 3,
        message: "Company Name at least 3 characters",
      },
      maxLength: {
        value: 40,
        message: "Company Name cannot be more than 20 characters",
      },
    },
  },
  {
    name: "description",
    labelText: "Company Description",
    size: true,
    type: "textarea",
    helperText: "*Describe company",
    placeholder: "Company for construction and building",
  },
  // {
  //   name: "emails",
  //   labelText: "Company Email",
  //   type: "multiple",
  //   inputType: "email",
  //   placeholder: "Enter Company Email",
  //   size: true,
  //   validationOptions: {
  //     required: "Email is required",
  //     pattern: {
  //       value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
  //       message: "Invalid email format. Please check and try again.",
  //     },
  //   },
  //   max: 3,
  // },
  // {
  //   name: "phones",
  //   labelText: "Company Phone",
  //   type: "multiple",
  //   inputType: "tel",
  //   placeholder: "Enter Company Phone",
  //   size: true,
  //   validationOptions: {
  //     required: "Phone is required",
  //     pattern: {
  //       value: /^\d{3}[-\s]?\d{3}[-\s]?\d{4}$/,
  //       message: "Invalid phone format. Please check and try again.",
  //     },
  //   },
  //   max: 3,
  // },
];

export const ISSUEREPORTFIELD = [
  {
    name: "title",
    labelText: "Issue Title",
    type: "text",
    placeholder: "Enter Issue Type",
    size: true,
    validationOptions: {
      required: "Issue Title is required",
      minLength: {
        value: 3,
        message: "Issue Title at least 3 characters long",
      },
      maxLength: {
        value: 20,
        message: "Issue Title not more than 20 characters long",
      },
      ...PATTERN,
    },
  },
  {
    name: "issue",
    labelText: "Issue",
    type: "select",
    options: Array.from(new Set(MENU.map((item) => item.name))).map((it) => ({
      label: it,
      value: it,
    })),
  },
  {
    name: "issueType",
    labelText: "Issue Type",
    type: "select",
    options: [
      { label: "Bug", value: "Bug" },
      { label: "Feature", value: "Feature" },
      { label: "Improvement", value: "Improvement" },
      { label: "Security", value: "Security" },
      { label: "Other", value: "Other" },
    ],
    validationOptions: {
      required: "Issue is required",
    },
  },
  {
    name: "description",
    labelText: "Description",
    size: true,
    type: "textarea",
    placeholder: "Describe the issue you are facing",
    validationOptions: {
      required: "Description is required",
    },
  },
];

export const LEAVECATEGORYFIELD = [
  {
    name: "leaveType",
    labelText: "Category of Leave",
    placeholder: "Enter category of leave",
    type: "text",
    validationOptions: {
      required: " Please enter a category of leave",
      minLength: {
        value: 3,
        message: "Name at least 3 characters long",
      },
      maxLength: {
        value: 20,
        message: "Name should not exceed 20 characters",
      },
      ...PATTERN,
    },
  },
  {
    name: "total",
    labelText: "Total Leave",
    type: "number",
    placeholder: "Enter total leave",
    validationOptions: {
      required: "Please enter the total leave",
      pattern: {
        // we can't allow to decimal values with not allow zero start with one
        // value: /^(?:[1-4]?\d|50)$/,
        value: /^(?!0$)(?:[1-4]?\d|50)$/,
        message: "Please enter a valid number",
      },
      minLength: {
        value: 1,
        message: "Please enter a valid number",
      },
      maxLength: {
        value: 2,
        message: "Please enter a valid number",
      },
    },
  },
  {
    name: "isPaid",
    labelText: "Leave Type",
    options: [
      { label: "Paid", value: "Paid" },
      { label: "Unpaid", value: "Unpaid" },
    ],
    type: "radio",
    validationOptions: { required: "Leave Type is required" },
  },
  {
    name: "isHide",
    labelText: "Leave View",
    options: [
      { label: "Hide", value: "Hide" },
      { label: "Unhide", value: "Unhide" },
    ],
    type: "radio",
    validationOptions: { required: "Leave View is required" },
  },
  {
    name: "note",
    labelText: "Note (optional)",
    type: "textarea",
    placeholder: "Add a note here for your leave category",
    size: true,
  },
];

export const EXPENSEFIELD = [
  {
    name: "expenseDescription",
    labelText: "Expense Name",
    type: "text",
    size: true,
    helperText: "*This name appear on expense table.",
    placeholder: " Enter  expense name",
    validationOptions: {
      required: " Expense name is required",
    },
  },
  {
    name: "expenseAmount",
    labelText: "Expense Amount",
    type: "number",
    inputMode: "numeric",
    placeholder: " Enter the amount",
    validationOptions: {
      required: "  Expense amount is required",
      pattern: {
        value: /^\d+$/,
        message: "Please enter a valid  number",
      },
    },
  },
  {
    name: "expenseDate",
    labelText: "Date",
    type: "date",
    placeholder: " Select Date",
    validationOptions: {
      required: "  Expense amount is required",
    },
  },
];
