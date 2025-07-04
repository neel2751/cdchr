import { cn } from "@/lib/utils";
import Link from "next/link";

const SiteNavBar = ({
  slug,
  children,
  menu,
  basePath,
  slugComponentMap,
  className,
  className2,
}) => {
  // Dynamically render the appropriate component for the slug
  function renderSlugComponent(slug) {
    const Component = slugComponentMap[slug]; // Get the component from the map
    return Component ? <Component /> : null; // Render the component if it exists
  }

  return (
    <>
      <nav className="relative bg-white border-stone-200 border-b mt-2">
        <div className="flex flex-wrap items-center lg:pb-2 lg:px-8 sm:px-6 px-4 gap-2 justify-between basis-full max-w-7xl w-full mx-auto">
          <div className="lg:basis-auto lg:grow-0 basis-full grow overflow-hidden">
            <div className="lg:block transition-all duration-300 overflow-scroll">
              <div className="overflow-y-auto max-h-[80vh]">
                <div className="lg:py-0 lg:gap-x-3 lg:items-center flex py-2">
                  {menu.map((item, index) => (
                    <Link
                      key={index}
                      className={`lg:gap-x-1.5 lg:w-auto text-sm text-start py-2 px-3 rounded-md gap-x-3 items-center flex w-full whitespace-nowrap ${
                        slug === item.link
                          ? "bg-indigo-100 text-indigo-600 font-medium"
                          : "hover:bg-stone-100 text-neutral-700 border border-gray-100"
                      }`}
                      href={`${basePath}/${item.link}`} // Use the dynamic base path
                    >
                      <item.icon className="w-4 h-4" />
                      {/* {item?.icon} */}
                      {item.name}
                      {item.isNew && (
                        <span
                          className={`font-medium text-xs py-0.5 px-2 rounded-md items-center inline-flex ${
                            slug === item.link
                              ? "bg-indigo-600 text-indigo-100"
                              : "bg-indigo-100 text-indigo-600"
                          }`}
                        >
                          {item.isNew}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>
      <div className={cn("p-4", className)}>
        {children}
        <div className={cn("", className2)}>
          {renderSlugComponent(slug)} {/* Dynamically render based on slug */}
        </div>
      </div>
    </>
  );
};

export default SiteNavBar;
