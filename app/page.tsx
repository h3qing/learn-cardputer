import CardputerDevice from "@/components/CardputerDevice";
import { DoneMark } from "@/components/Progress";
import { getAllLessons, getCourse, shortTopics } from "@/lib/lessons";

function DifficultyDots({ level }: { level: number }) {
  return (
    <span className="difficulty" aria-label={`难度 ${level}/5`}>
      {Array.from({ length: 5 }, (_, i) => (i < level ? "●" : "○")).join("")}
    </span>
  );
}

export default function HomePage() {
  const course = getCourse();
  const lessons = getAllLessons();

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">开源硬件学习计划 · OPEN SOURCE</p>
          <h1>{course.title}</h1>
          <p className="hero-tagline">{course.tagline}</p>
          <p className="hero-intro">{course.intro}</p>
          <div className="hero-actions">
            {lessons.length > 0 && (
              <a className="btn-primary" href={`/lessons/${lessons[0].slug}`}>
                从第 1 课开始
              </a>
            )}
            <a className="btn-ghost" href="#lessons">
              浏览全部课程
            </a>
          </div>
        </div>
        <CardputerDevice />
      </section>

      <section id="lessons" className="roadmap-section">
        <h2 className="section-title">
          <span className="section-title-silk">BUS</span>课程总线
        </h2>
        <p className="section-note">
          {lessons.length} 课挂在同一条总线上,按顺序点亮它们。每课深挖一个硬件子系统,做出一个能拿去炫耀的小东西。
        </p>
        <ol className="roadmap">
          {lessons.map((lesson) => (
            <li key={lesson.slug} className="roadmap-item">
              <a href={`/lessons/${lesson.slug}`} className="lesson-card">
                <div className="lesson-card-head">
                  <span className="lesson-ref">
                    U{lesson.order} · {shortTopics(lesson.hardware)}
                  </span>
                  <DoneMark slug={lesson.slug} />
                </div>
                <h3>{lesson.title}</h3>
                <p className="lesson-summary">{lesson.summary}</p>
                <div className="lesson-meta">
                  <DifficultyDots level={lesson.difficulty} />
                  <span>约 {lesson.estHours} 小时</span>
                  <span className="lesson-project">作品:{lesson.project}</span>
                </div>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section id="about" className="about-section">
        <h2 className="section-title">
          <span className="section-title-silk">README</span>这个计划是怎么运作的
        </h2>
        <div className="about-grid">
          <div>
            <h3>课程给原理,代码自己写</h3>
            <p>
              每课讲透一个硬件机制,给最小示例和分步提示,但挑战任务没有标准答案——固件由我自己动手实现,放在仓库的 firmware/ 目录里,和课程一起开源。
            </p>
          </div>
          <div>
            <h3>你也可以跟着学</h3>
            <p>
              准备一台 Cardputer(约 $30)、一根 USB-C 线和一台电脑就能开始。所有课程内容自由取用,发现错误欢迎提 issue。
            </p>
          </div>
          <div>
            <h3>为什么是 Cardputer</h3>
            <p>
              它把显示、键盘、音频、无线、红外、存储塞进一张卡片,每个子系统恰好对应一种经典总线——SPI、GPIO、I2S、I2C。一台设备,就是一门完整的硬件入门课。
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
