import { useEffect, useState } from "react";
import {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";
import {
  CODE_SCOUT_GALLERY_SLIDES,
  type CodeScoutGallerySlide,
} from "@/constants/codeScoutGallery";

function GallerySlide({ slide }: { slide: CodeScoutGallerySlide }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border border-border bg-card/60 shadow-sm",
          "aspect-video w-full",
        )}
      >
        <img
          src={slide.src}
          alt={slide.alt}
          className="h-full w-full object-cover object-top"
          loading="lazy"
          decoding="async"
        />
      </div>
      {slide.caption ? (
        <p className="text-center text-xs text-muted-foreground">{slide.caption}</p>
      ) : null}
    </div>
  );
}

function EmptyGalleryHint({ compact }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border",
        "bg-muted/20 px-4 py-8 text-center",
        compact ? "min-h-[180px] lg:min-h-[240px]" : "min-h-[200px]",
      )}
    >
      <p className="text-sm font-medium text-foreground">Your screenshots here</p>
      <p className="max-w-md text-xs text-muted-foreground leading-relaxed">
        Add files to{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">public/code-scout-gallery/</code>
        , list them in{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">codeScoutGallery.ts</code>.
      </p>
    </div>
  );
}

type GalleryVariant = "standalone" | "hero";

export function CodeScoutScreenshotGallery({ variant = "standalone" }: { variant?: GalleryVariant }) {
  const slides = CODE_SCOUT_GALLERY_SLIDES;
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap());
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  if (slides.length === 0) {
    if (variant === "hero") {
      return (
        <div className="w-full" aria-label="Product screenshots placeholder">
          <EmptyGalleryHint compact />
        </div>
      );
    }
    return (
      <section className="space-y-4" aria-labelledby="gallery-heading">
        <div className="space-y-1">
          <h2 id="gallery-heading" className="text-lg font-semibold tracking-tight">
            In the app
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            A quick visual tour of the desktop workbench—add your own shots below.
          </p>
        </div>
        <EmptyGalleryHint />
      </section>
    );
  }

  const carousel = (
    <Carousel
        setApi={setApi}
        opts={{
          align: "start",
          loop: slides.length > 1,
        }}
        className="w-full"
      >
        <div className="relative px-11 sm:px-12">
          <CarouselContent>
            {slides.map((slide, i) => (
              <CarouselItem key={`${slide.src}-${i}`} className="basis-full">
                <GallerySlide slide={slide} />
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious
            type="button"
            className="left-0 h-9 w-9 border-border bg-background/90 shadow-sm backdrop-blur-sm hover:bg-background"
          />
          <CarouselNext
            type="button"
            className="right-0 h-9 w-9 border-border bg-background/90 shadow-sm backdrop-blur-sm hover:bg-background"
          />
        </div>

        {slides.length > 1 ? (
          <div
            className="mt-4 flex flex-wrap justify-center gap-2"
            role="tablist"
            aria-label="Screenshot slides"
          >
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={current === i}
                aria-label={`Go to slide ${i + 1} of ${slides.length}`}
                className={cn(
                  "h-2 rounded-full transition-all duration-200",
                  current === i ? "w-6 bg-primary" : "w-2 bg-muted-foreground/35 hover:bg-muted-foreground/55",
                )}
                onClick={() => api?.scrollTo(i)}
              />
            ))}
          </div>
        ) : null}
      </Carousel>
  );

  if (variant === "hero") {
    return (
      <div className="w-full" aria-label="Product screenshots">
        {carousel}
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="gallery-heading">
      <div className="space-y-1">
        <h2 id="gallery-heading" className="text-lg font-semibold tracking-tight">
          In the app
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Screenshots from the real desktop build—use the arrows or dots to browse.
        </p>
      </div>
      {carousel}
    </section>
  );
}
