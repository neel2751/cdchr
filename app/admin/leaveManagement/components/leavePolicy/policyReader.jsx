import React from "react";

const PolicyReader = () => {
  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-col gap-0 p-0 sm:max-h-[min(640px,80vh)] [&>button:last-child]:top-3.5">
        <CardTitle className="border-b border-border px-6 py-4 text-base">
          Leave Policy
          <p className="mt-2 text-sm font-medium text-neutral-500 max-w-2xl">
            Our company has a comprehensive leave policy that ensures all
            employees have a fair and reasonable amount of time off to recharge
            and attend to personal matters.
          </p>
        </CardTitle>
      </CardHeader>
      <div ref={contentRef} onScroll={handleScroll} className="overflow-y-auto">
        <CardContent>
          <div className="px-6 py-4">
            <div className="space-y-4 [&_strong]:font-semibold [&_strong]:text-foreground">
              <div className="space-y-4">
                <div className="space-y-1">
                  <p>
                    <strong>Acceptance Terms of Policy </strong>
                  </p>
                  <p>
                    All employees are expected to accept the terms of this
                    policy. By accepting this policy, employees agree to abide
                    by the rules and regulations outlined in this document.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>User Account Responsibilities</strong>
                  </p>
                  <p>
                    Users are responsible for maintaining the confidentiality of
                    their account credentials. Any activities occurring under a
                    user&lsquo;s account are the sole responsibility of the
                    account holder. Users must notify the website administrators
                    immediately of any unauthorized account access.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Content Usage and Restrictions</strong>
                  </p>
                  <p>
                    The website and its original content are protected by
                    intellectual property laws. Users may not reproduce,
                    distribute, modify, create derivative works, or commercially
                    exploit any content without explicit written permission from
                    the company.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Limitation of Liability</strong>
                  </p>
                  <p>
                    The website provides content &ldquo;as is&ldquo; without any
                    warranties. The website owners shall not be liable for
                    direct, indirect, incidental, consequential, or punitive
                    damages arising from user interactions with the platform.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>User Conduct Guidelines</strong>
                  </p>
                  <ul className="list-disc pl-6">
                    <li>Not upload harmful or malicious content</li>
                    <li>Respect the rights of other users</li>
                    <li>
                      Avoid activities that could disrupt website functionality
                    </li>
                    <li>Comply with applicable local and international laws</li>
                  </ul>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Holiday Policy</strong>
                  </p>
                  <p>
                    The holidy policy sets out employees' entitlement to annual
                    leave and the Company rules on taking annual leave. Under
                    the working time regulations 1998, employees are entitled to
                    a minimum of 5.6 weeks paid annual leave per year. The
                    entitlement includes public holidays.
                  </p>
                  <p className="pt-2">
                    5.6 weeks of annual leave will convert into different
                    entitlements for each employee dependent on their individual
                    working arrangements. Individual contracts of employment
                    will detail an employee’s personal entitlement. For example,
                    5.6 working weeks leave will, by the nature of their working
                    week, convert to fewer days or hours of annual leave for a
                    part time employee when compared to a full time employee.
                    The pro-rata principle may also apply to other practical
                    arrangements.
                  </p>
                  <p className="pt-2">
                    All leave must be pre-authorised by the Company. Taking
                    leave without authorisation will be considered a gross
                    misconduct offence. Taking leave despite a declined request
                    will be considered a gross misconduct offence. Gross
                    misconduct offences may result in dismissal without notice.
                    Further rules on booking leave from work are given below.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Company requirements</strong>
                  </p>
                  <p>
                    The Company may reasonably require an employee to take
                    annual leave without prior notification for reasons which
                    will be explained to the employee at the time.
                  </p>
                  <p className="pt-2">
                    The Company operates an entire shut down each year between
                    [insert details] and requires all employees to take annual
                    leave to cover this period of time. This period is not in
                    addition to annual leave entitlement so employees need to
                    retain sufficient annual leave to cover this period. It is
                    the employee’s responsibility to ensure that sufficient
                    annual leave entitlement remains each year to take during
                    this period. Employees who do not have sufficient
                    entitlement remaining should speak to their line manager
                    about other available options.
                  </p>
                  <p className="pt-2">
                    The Company may ask an employee to cancel any previously
                    agreed leave. There may be various reasons for this, such as
                    operational or staffing issues, or business commitments that
                    require the employee’s presence. The Company recognises the
                    inconvenience that this may cause an employee and,
                    therefore, understands that the employee may refuse this
                    request.
                  </p>
                  <p className="pt-2">
                    The Company will make a decision on whether, where the
                    cancellation is agreed and the employee suffers a financial
                    detriment eg lost deposits etc, the employee is to be
                    reimbursed.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Booking leave</strong>
                  </p>
                  <p>
                    Employees must give notice of their request to take leave.
                    Applications should be sent to [delete as appropriate -
                    their line manager in writing/using the online holiday
                    request forms/the HR Department].
                  </p>
                  <p className="pt-2">
                    Employees should not make any firm travel or accommodation
                    arrangements etc until they have received written
                    confirmation that their request for leave has been granted.
                    There may be circumstances where the Company cannot grant
                    the request, such as operational/staffing requirements. The
                    Company is not liable for any loss incurred by an employee,
                    such as lost deposits etc, if they incur costs and make
                    commitments prior to receiving confirmation.
                  </p>
                  <p className="pt-2">
                    There may be more requests than usual for leave that
                    coincide with school holidays/half terms, due to the number
                    of employees with children of school age. The Company will
                    make every effort to accept as many of these requests as
                    possible, but has to have regard to its operations and
                    ensuring there is sufficient cover for all work to be
                    undertaken, considerations which sometimes need to take
                    priority over granting all these types of requests.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Public holidays</strong>
                  </p>
                  <p>
                    Due to the needs of the business, it may be necessary for an
                    employee to work on a public holiday. Where this happens,
                    employees will be entitled to take a day’s leave at another
                    time in the leave year to be agreed with the line manager in
                    accordance with business needs.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Use it or Lose it</strong>
                  </p>
                  <p>
                    The basic principle of statutory annual leave entitlement is
                    that this will be lost if it has not been used. There are
                    some exceptions to this rule, but usually the annual leave
                    accrued in any leave year must be used in that same year.
                    This is important because taking time off work helps staff
                    to get sufficient rest breaks, and to keep physically and
                    mentally healthy. However, it may not always be possible for
                    workers to use their full entitlement in time. The question
                    is, therefore, how an employer should deal with any accrued
                    but unused days.
                  </p>
                  <p className="pt-2">
                    If a worker has been on long-term sick leave, they can carry
                    over the first 20 days of their 28 day entitlement on their
                    return to work, whilst a worker who has been prevented from
                    taking some or all of their paid holiday due to maternity or
                    family leave, they can carry over up to one years’ statutory
                    entitlement (5.6 weeks or 28 days) into the following year.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Holiday Pay</strong>
                  </p>
                  <p>
                    During annual leave, employees will receive their normal
                    pay.
                  </p>
                  <p className="pt-2 text-neutral-600">
                    <span className="text-rose-600">Note*</span>
                    The calculation of holiday pay can be tricky when employees
                    work according to atypical patterns. Where pay varies,
                    holiday pay is usually calculated by taking an average over
                    the previous 12 weeks in which work was carried out. Rolled
                    up holiday pay (where an additional element representing
                    holiday pay is added to pay for each hour worked) is
                    technically unlawful. Employees may alternatively receive a
                    payment for accrued leave at the end of each assignment
                    rather than being represented as an hourly uplift.
                  </p>
                  <p className="pt-2 text-neutral-600">
                    <span className="text-rose-600">*</span>
                    Calculating annual leave entitlement may also be complicated
                    for employees who work ad hoc hours. One suggested method
                    calculates accrual of leave entitlement on the basis of
                    12.07% for every hour worked.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>New starters and pre-booked leave</strong>
                  </p>
                  <p>
                    During the recruitment process, prospective employees may be
                    asked whether they have any leave booked that would take
                    place after commencement of employment. If the individual is
                    recruited, the Company will normally allow such leave to be
                    taken.
                  </p>
                  <p className="pt-2">
                    The rules on accrual of annual leave may mean that the
                    employee has not, at the time that leave is to be taken,
                    accrued such length of leave to cover their holiday. In this
                    case, the employee and the line manager will agree how any
                    time off in excess of accrued leave will be covered.
                  </p>
                  <p className="pt-2">
                    It is Company policy not to permit leave within [insert time
                    period] of commencement of employment unless leave was
                    pre-booked before employment commenced.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Holidays and sickness</strong>
                  </p>
                  <p>
                    The normal sickness notification procedures will apply to an
                    employee when they are on leave and wish to reallocate the
                    period of leave as sickness with the result that reconvened
                    leave may be taken at another time in the leave year. Where
                    the required notification is made, the Company may permit
                    those days to be classed as sick days and equivalent time
                    off taken as paid leave later in the leave year provide the
                    leave falls within the statutory minimum entitlement. The
                    days on which the leave is to be taken must be agreed with
                    the Company.
                  </p>
                  <p className="pt-2">
                    Employees who are on an overseas holiday when they fall sick
                    should contact the Company as soon as reasonably
                    practicable.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Untaken annual leave</strong>
                  </p>
                  <p>
                    The Company encourages employees to use all of their leave
                    entitlement each year so that they have the opportunity to
                    rest. Employees should ensure they take at least four weeks
                    annual leave in each leave year.
                  </p>
                  <p className="pt-2">
                    Ordinarily, untaken leave cannot be carried forward into the
                    next leave year and will be lost. Approval must be sought
                    from [delete as appropriate - employee’s line manager/HR
                    department] if an employee wishes to carry forward any
                    annual leave into the next leave year. The line manager has
                    sole discretion to permit or decline this, subject to the
                    provisions on sickness below.
                  </p>
                  <p className="pt-2">
                    If sickness means that an employee cannot take their full
                    leave entitlement in a leave year, the employee may be able
                    to carry forward some of the leave to the next leave year.
                    This is usually limited to a maximum of four weeks leave,
                    minus any leave already taken (including public holidays).
                  </p>
                  <p className="pt-2">
                    Ordinarily, the Company will not permit payment in lieu of
                    annual leave unless exceptional circumstances apply. In
                    every case, payment in lieu of the statutory minimum
                    entitlement will not be permitted.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Termination of employment</strong>
                  </p>
                  <p>
                    When employment terminates part way through a leave year,
                    their leave entitlement will be recalculated on a pro-rata
                    basis. This will determine the amount of leave the employee
                    would be entitled to, for the period of service during the
                    leave year.
                  </p>
                  <p className="pt-2">
                    Any outstanding leave accrued but untaken will be paid to
                    the employee in their final pay. This is subject to the
                    right of the Company for the employee to take their
                    outstanding leave during their notice period. Otherwise, the
                    amount due for outstanding leave will be added to the
                    employee’s final pay.
                  </p>
                  <p className="pt-2">
                    If the employee has exceeded their pro-rata entitlement to
                    holidays at the time they leave their employment, this will
                    be classed as an overpayment and an amount to cover this
                    will be deducted from their final pay, subject to the
                    maximum that their final pay permits.
                  </p>
                </div>
                <div className="space-y-1">
                  <p>
                    <strong>Modifications to Terms</strong>
                  </p>
                  <p>
                    The website reserves the right to modify these terms at any
                    time. Continued use of the website after changes constitutes
                    acceptance of the new terms.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </div>
      <CardFooter className="border-t border-border px-6 py-4 sm:items-center justify-end bottom-0 sticky bg-white">
        {!hasReadToBottom && (
          <span className="grow text-xs text-muted-foreground max-sm:text-center">
            Read all terms before accepting.
          </span>
        )}
        <Button type="button" disabled={!hasReadToBottom}>
          I agree
        </Button>
      </CardFooter>
    </Card>
  );
};

export default PolicyReader;
