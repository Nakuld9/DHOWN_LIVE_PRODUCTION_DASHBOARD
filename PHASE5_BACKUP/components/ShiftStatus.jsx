import React from "react";

const ShiftStatus = () => {
  const now = new Date();

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const currentTime =
    currentHour + currentMinute / 60;

  const isDayShift =
    currentTime >= 8 && currentTime < 20;

  const shiftName = isDayShift ? "Shift D" : "Shift N";

  const shiftTime = isDayShift
    ? "08:00 AM - 08:00 PM"
    : "08:00 PM - 08:00 AM";

  const shiftStart = isDayShift ? 8 : 20;

  let elapsedHours;

  if (isDayShift) {
    elapsedHours = currentTime - 8;
  } else {
    elapsedHours =
      currentTime >= 20
        ? currentTime - 20
        : currentTime + 4;
  }

  const progress = Math.min(
    Math.round((elapsedHours / 12) * 100),
    100
  );

  const elapsedText =
    `${Math.floor(elapsedHours)}h ${Math.round(
      (elapsedHours % 1) * 60
    )}m`;

  return (
    <div
      style={{
        background: "#081426",
        border: "1px solid #16345d",
        borderRadius: "12px",
        padding: "20px",
        color: "white",
      }}
    >
      <h3>SHIFT STATUS</h3>

      <h4>{shiftName}</h4>

      <p>{shiftTime}</p>

      <div
        style={{
          width: "100%",
          height: "10px",
          background: "#2d3748",
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "#4ade80",
          }}
        />
      </div>

      <p style={{ marginTop: "10px" }}>
        {elapsedText} Elapsed | {progress}%
      </p>
    </div>
  );
};

export default ShiftStatus;