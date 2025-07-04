export default function EmployeeCompensation() {
  return (
    <div className="space-y-8">
      <h2 className="text-xl font-medium">Compensation History</h2>
      <div className="grid gap-6">
        <div className="border rounded-md p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xl font-medium">862.00 USD per month</h3>
              <p className="text-muted-foreground">
                Effective date: May 10, 2015
              </p>
            </div>
            <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">
              Current
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Department
              </h4>
              <p>Creative Associate</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Position
              </h4>
              <p>Project Manager</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Approved by
              </h4>
              <p>Alex Foster</p>
            </div>
          </div>
        </div>

        <div className="border rounded-md p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xl font-medium">1560.00 USD per quarter</h3>
              <p className="text-muted-foreground">
                Effective date: Jun 08, 2022
              </p>
            </div>
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
              Bonus
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Department
              </h4>
              <p>Marketing Team</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Position
              </h4>
              <p>Team Lead</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Approved by
              </h4>
              <p>Jack Danniel</p>
            </div>
          </div>
        </div>

        <div className="border rounded-md p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xl font-medium">378.00 USD per week</h3>
              <p className="text-muted-foreground">
                Effective date: Jun 08, 2022
              </p>
            </div>
            <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm">
              Allowance
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Department
              </h4>
              <p>Finance & Accounting</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Position
              </h4>
              <p>Senior Consultant</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Approved by
              </h4>
              <p>John Miller</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
