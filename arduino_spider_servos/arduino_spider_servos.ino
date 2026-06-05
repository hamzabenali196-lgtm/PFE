#include <SoftwareSerial.h>
#include <LobotServoController.h>

SoftwareSerial mySerial(10, 11);
LobotServoController myse(mySerial);

// ================= INVERSION =================
bool isInverted(int id) {
  return (
    id == 2 || id == 5 || id == 8 ||
    id == 11 || id == 14 || id == 17 ||
    id == 3 || id == 6 || id == 9
  );
}

int invert(int v) {
  return 3000 - v;
}

int fix(int id, int v) {
  if (isInverted(id)) return invert(v);
  return v;
}

// ================= POSITIONS =================
const int CENTER = 1500;
const int H = 1800;        // robot height
const int LEG_UP = 1300;   // lift leg
const int LEG_DOWN = 1800; // put leg down

const int HIP_BACK = 1200;
const int HIP_FRONT = 1650;
const int HIP_CENTER = 1500;

const int STEP_TIME = 350;

// ================= MOVE ALL TO CENTER =================
void centerAll(int t) {
  LobotServo servos[] = {
    {1, fix(1, CENTER)}, {2, fix(2, CENTER)}, {3, fix(3, CENTER)},
    {4, fix(4, CENTER)}, {5, fix(5, CENTER)}, {6, fix(6, CENTER)},
    {7, fix(7, CENTER)}, {8, fix(8, CENTER)}, {9, fix(9, CENTER)},
    {10, fix(10, CENTER)}, {11, fix(11, CENTER)}, {12, fix(12, CENTER)},
    {13, fix(13, CENTER)}, {14, fix(14, CENTER)}, {15, fix(15, CENTER)},
    {16, fix(16, CENTER)}, {17, fix(17, CENTER)}, {18, fix(18, CENTER)}
  };

  myse.moveServos(servos, 18, t);
  delay(t + 200);
}

// ================= STAND POSITION =================
void standPosition(int t) {
  LobotServo servos[] = {
    {1, fix(1, CENTER)}, {2, fix(2, CENTER)}, {3, fix(3, H)},
    {4, fix(4, CENTER)}, {5, fix(5, CENTER)}, {6, fix(6, H)},
    {7, fix(7, CENTER)}, {8, fix(8, CENTER)}, {9, fix(9, H)},
    {10, fix(10, CENTER)}, {11, fix(11, CENTER)}, {12, fix(12, H)},
    {13, fix(13, CENTER)}, {14, fix(14, CENTER)}, {15, fix(15, H)},
    {16, fix(16, CENTER)}, {17, fix(17, CENTER)}, {18, fix(18, H)}
  };

  myse.moveServos(servos, 18, t);
  delay(t + 200);
}

// ================= HI ACTION WITH LEG 6 =================
// Leg 6 = servos 16, 17, 18
void sayHi() {
  standPosition(500);

  LobotServo raiseLeg6[] = {
    {16, fix(16, CENTER)},
    {17, fix(17, 1200)},
    {18, fix(18, 1200)}
  };

  myse.moveServos(raiseLeg6, 3, 500);
  delay(700);

  for (int i = 0; i < 4; i++) {
    LobotServo wave1[] = {
      {16, fix(16, 1150)},
      {17, fix(17, 1200)},
      {18, fix(18, 1200)}
    };

    myse.moveServos(wave1, 3, 300);
    delay(350);

    LobotServo wave2[] = {
      {16, fix(16, 1850)},
      {17, fix(17, 1200)},
      {18, fix(18, 1200)}
    };

    myse.moveServos(wave2, 3, 300);
    delay(350);
  }

  LobotServo returnLeg6[] = {
    {16, fix(16, CENTER)},
    {17, fix(17, CENTER)},
    {18, fix(18, H)}
  };

  myse.moveServos(returnLeg6, 3, 500);
  delay(700);
}

// ================= TRIPOD WALK =================
void walkForward(int steps) {
  for (int step = 0; step < steps; step++) {
    LobotServo tripodA_lift[] = {
      {2, fix(2, LEG_UP)}, {3, fix(3, LEG_UP)},
      {8, fix(8, LEG_UP)}, {9, fix(9, LEG_UP)},
      {14, fix(14, LEG_UP)}, {15, fix(15, LEG_UP)}
    };

    myse.moveServos(tripodA_lift, 6, STEP_TIME);
    delay(STEP_TIME + 80);

    LobotServo phase1[] = {
      {1, fix(1, HIP_FRONT)},
      {7, fix(7, HIP_FRONT)},
      {13, fix(13, HIP_FRONT)},
      {4, fix(4, HIP_BACK)},
      {10, fix(10, HIP_BACK)},
      {16, fix(16, HIP_BACK)}
    };

    myse.moveServos(phase1, 6, STEP_TIME);
    delay(STEP_TIME + 80);

    LobotServo tripodA_down[] = {
      {2, fix(2, CENTER)}, {3, fix(3, H)},
      {8, fix(8, CENTER)}, {9, fix(9, H)},
      {14, fix(14, CENTER)}, {15, fix(15, H)}
    };

    myse.moveServos(tripodA_down, 6, STEP_TIME);
    delay(STEP_TIME + 100);

    LobotServo tripodB_lift[] = {
      {5, fix(5, LEG_UP)}, {6, fix(6, LEG_UP)},
      {11, fix(11, LEG_UP)}, {12, fix(12, LEG_UP)},
      {17, fix(17, LEG_UP)}, {18, fix(18, LEG_UP)}
    };

    myse.moveServos(tripodB_lift, 6, STEP_TIME);
    delay(STEP_TIME + 80);

    LobotServo phase2[] = {
      {4, fix(4, HIP_FRONT)},
      {10, fix(10, HIP_FRONT)},
      {16, fix(16, HIP_FRONT)},
      {1, fix(1, HIP_BACK)},
      {7, fix(7, HIP_BACK)},
      {13, fix(13, HIP_BACK)}
    };

    myse.moveServos(phase2, 6, STEP_TIME);
    delay(STEP_TIME + 80);

    LobotServo tripodB_down[] = {
      {5, fix(5, CENTER)}, {6, fix(6, H)},
      {11, fix(11, CENTER)}, {12, fix(12, H)},
      {17, fix(17, CENTER)}, {18, fix(18, H)}
    };

    myse.moveServos(tripodB_down, 6, STEP_TIME);
    delay(STEP_TIME + 100);
  }
}

// ================= SETUP =================
void setup() {
  mySerial.begin(9600);
  Serial.begin(9600);

  delay(3000);

  centerAll(700);
  standPosition(700);

  sayHi();

  delay(500);

  standPosition(500);
  walkForward(10);

  standPosition(700);
  delay(500);
  centerAll(700);

  myse.stopActionGroup();
}

void loop() {}
