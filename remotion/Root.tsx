import React from "react";
import { Composition } from "remotion";
import { Commercial } from "./compositions/Commercial";
import { Poster } from "./compositions/Poster";
import { Loop } from "./compositions/Loop";
import { TestCard } from "./compositions/TestCard";
import { CommercialPropsSchema, LoopPropsSchema, PosterPropsSchema, TestCardPropsSchema, type CommercialProps, type LoopProps, type PosterProps, type TestCardProps } from "./schema";

const demoCommercial: CommercialProps = CommercialPropsSchema.parse({
  scenes: [
    { id: "s1", durationS: 3, layout: "title", kicker: "Orkestr", headline: "عنوان المشهد الأول" },
    { id: "s2", durationS: 3, layout: "end-card", headline: "Orkestr", body: "local-first studio" },
  ],
});

export const Root: React.FC = () => (
  <>
    <Composition
      id="Commercial"
      component={Commercial}
      schema={CommercialPropsSchema}
      defaultProps={demoCommercial}
      durationInFrames={180}
      fps={30}
      width={1920}
      height={1080}
      calculateMetadata={({ props }) => {
        const p = CommercialPropsSchema.parse(props);
        const total = p.scenes.reduce((s, x) => s + x.durationS, 0);
        return { durationInFrames: Math.max(1, Math.round(total * p.fps)), fps: p.fps, width: p.width, height: p.height, props: p };
      }}
    />
    <Composition
      id="Poster"
      component={Poster}
      schema={PosterPropsSchema}
      defaultProps={PosterPropsSchema.parse({ headline: "Orkestr" }) as PosterProps}
      durationInFrames={1}
      fps={30}
      width={1080}
      height={1350}
      calculateMetadata={({ props }) => {
        const p = PosterPropsSchema.parse(props);
        return { width: p.width, height: p.height, props: p };
      }}
    />
    <Composition
      id="Loop"
      component={Loop}
      schema={LoopPropsSchema}
      defaultProps={LoopPropsSchema.parse({ images: ["https://placehold.co/1920x1080.png"] }) as LoopProps}
      durationInFrames={360}
      fps={30}
      width={1920}
      height={1080}
      calculateMetadata={({ props }) => {
        const p = LoopPropsSchema.parse(props);
        return { durationInFrames: Math.round(p.durationS * p.fps), fps: p.fps, width: p.width, height: p.height, props: p };
      }}
    />
    <Composition
      id="TestCard"
      component={TestCard}
      schema={TestCardPropsSchema}
      defaultProps={TestCardPropsSchema.parse({}) as TestCardProps}
      durationInFrames={60}
      fps={30}
      width={640}
      height={360}
      calculateMetadata={({ props }) => {
        const p = TestCardPropsSchema.parse(props);
        return { durationInFrames: Math.round(p.durationS * p.fps), fps: p.fps, width: p.width, height: p.height, props: p };
      }}
    />
  </>
);
