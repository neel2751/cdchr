import { Fragment } from "react";

export default function EmployeeOverview({ data }) {
  // const data = [
  //   {
  //     title: "Bank Account Details",
  //     content: [
  //       { label: "Account Name", value: "Jhon Doe" },
  //       { label: "Account No", value: "10503923" },
  //       { label: "Sort Code", value: "202403" },
  //     ],
  //   },
  //   {
  //     title: "Emergency Contact Details",
  //     content: [
  //       { label: "Name", value: "Jhon Doe" },
  //       { label: "Contact No", value: "07810503923" },
  //       { label: "Address", value: "United Kingdom" },
  //       { label: "Relation", value: "Father" },
  //     ],
  //   },
  //   {
  //     title: "Immigration Deatils",
  //     content: [
  //       { label: "Nationality", value: "British" },
  //       { label: "Visa Type", value: "PSW" },
  //       { label: "Employee Type", value: "Full Time" },
  //       { label: "Employee NI", value: "1234567890" },
  //       // { label: "Join Date", value: "22 Sep, 2022" },
  //       // { label: "End Date", value: "10 Nov, 2023" },
  //     ],
  //   },
  // ];

  return (
    <div className="space-y-2 ">
      {/* Start Card */}
      {data?.map((item, index) => (
        <ProfileCard key={index} data={item} />
      ))}
      {/* End Card */}
    </div>
  );
}

const ProfileCard = ({ data }) => (
  <div className="px-5 bg-white rounded-xl divide-y divide-dashed divide-gray-300 border">
    <div className="py-5">
      <div className="mb-3">
        <h2 className="text-gray-800 font-semibold text-pretty">
          {data?.title}
        </h2>
      </div>
      {/* List */}
      <dl className="sm:gap-y-2 sm:grid-cols-2 gap-x-4 grid-cols-1 grid">
        {data?.content?.map((item, index) => (
          <Fragment key={index}>
            <dt className="sm:py-0.5 text-gray-500 text-base">{item?.label}</dt>
            <dd className="sm:py-0.5 text-gray-700 font-semibold text-base text-pretty">
              {item?.value}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  </div>
);
