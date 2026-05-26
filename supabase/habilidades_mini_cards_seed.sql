-- UiX-lingo: mini cards → public.habilidades (35 registros)
-- Fuente: 35_talentos_mini_cards.md
-- Ejecutar en Supabase → SQL Editor (PASO 1 + PASO 2 en un solo run)

ALTER TABLE public.habilidades
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS sort_order smallint,
  ADD COLUMN IF NOT EXISTS descripcion text,
  ADD COLUMN IF NOT EXISTS como_lo_vives text,
  ADD COLUMN IF NOT EXISTS recomendaciones text,
  ADD COLUMN IF NOT EXISTS habilidades_clave text,
  ADD COLUMN IF NOT EXISTS ojo_con text;

CREATE UNIQUE INDEX IF NOT EXISTS habilidades_slug_key ON public.habilidades (slug);

COMMENT ON COLUMN public.habilidades.slug IS 'Identificador estable (activador, determinacion, etc.)';
COMMENT ON COLUMN public.habilidades.sort_order IS 'Orden 1-35 según catálogo UiX-lingo';
COMMENT ON COLUMN public.habilidades.descripcion IS '¿Qué es? — definición breve del talento';
COMMENT ON COLUMN public.habilidades.como_lo_vives IS '¿Cómo lo vives? — texto en segunda persona';
COMMENT ON COLUMN public.habilidades.recomendaciones IS '¿Qué te recomendamos? — lista de acciones';
COMMENT ON COLUMN public.habilidades.habilidades_clave IS 'Verbos clave separados por |';
COMMENT ON COLUMN public.habilidades.ojo_con IS 'Advertencia / riesgo de sobreusar el talento';

UPDATE public.habilidades SET
  slug = 'activador',
  sort_order = 1,
  descripcion = E'Iniciar acciones con rapidez y decisión. Convertir ideas en resultados tangibles sin esperar al momento perfecto.',
  como_lo_vives = E'Eres quien dice "¡Vamos a hacerlo!" antes que nadie. No te quedas en la charla, propones, organizas y pones manos a la obra. Tu energía impulsa proyectos y equipos hacia adelante.',
  recomendaciones = E'Participa en proyectos donde se requiera iniciar tareas desde cero
Toma decisiones rápidas en situaciones cotidianas
Practica el hábito de "empezar ahora" en lugar de esperar
Rodéate de personas que valoren la acción y el movimiento
Reflexiona sobre los aprendizajes obtenidos al actuar',
  habilidades_clave = E'Iniciar | Ejecutar | Impulsar | Movilizar | Decidir',
  ojo_con = E'Impulsar acciones sin planificación puede generar caos'
WHERE slug = 'activador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'activador';

UPDATE public.habilidades SET
  slug = 'actualizador',
  sort_order = 2,
  descripcion = E'Mantenerse al día, aprender constantemente y compartir conocimiento útil con los demás.',
  como_lo_vives = E'Preguntas "¿Sabías que...?" o "Acabo de leer que...". Te gusta aprender cosas nuevas y compartirlas. En el trabajo, mantienes a tu equipo informado y tomas decisiones con base en datos actuales.',
  recomendaciones = E'Suscríbete a newsletters, canales de YouTube o podcasts sobre temas que te interesan
Comparte con tu equipo artículos, videos o noticias relevantes
Participa en cursos, webinars o talleres de forma regular
Investiga antes de tomar decisiones importantes
Crea una rutina de aprendizaje diario (leer, escuchar, ver algo nuevo)',
  habilidades_clave = E'Aprender | Investigar | Compartir | Actualizar | Informar',
  ojo_con = E'Cambiar por cambiar puede generar inestabilidad'
WHERE slug = 'actualizador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'actualizador';

UPDATE public.habilidades SET
  slug = 'articulador',
  sort_order = 3,
  descripcion = E'Reconstruir el pasado y entender cómo los eventos, decisiones y relaciones han dado forma al presente.',
  como_lo_vives = E'Eres quien recuerda cómo empezó todo, quién dijo qué, cómo se conocieron. Te gusta contar historias con contexto. Los demás te buscan para que expliques "cómo fue que llegamos aquí".',
  recomendaciones = E'Escribe crónicas o bitácoras de proyectos, viajes o reuniones
Investiga la historia de tu empresa, equipo o comunidad
Entrevista a personas mayores o con experiencia para conocer su historia
Crea líneas del tiempo o mapas de eventos importantes
Participa en proyectos donde se necesite documentar procesos',
  habilidades_clave = E'Narrar | Conectar | Contextualizar | Significar | Documentar',
  ojo_con = E'Hablar demasiado sin dejar espacio a otros para participar'
WHERE slug = 'articulador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'articulador';

UPDATE public.habilidades SET
  slug = 'auto-seguridad',
  sort_order = 4,
  descripcion = E'Tomar decisiones con confianza y transmitir certeza a los demás.',
  como_lo_vives = E'Tomas decisiones rápidamente, propones qué hacer y transmites seguridad al grupo. No dudas en expresar tu punto de vista. Eres quien guía cuando hay incertidumbre.',
  recomendaciones = E'Toma decisiones cotidianas sin depender de la aprobación externa
Reflexiona sobre aciertos pasados para fortalecer tu confianza personal
Guía a otros en momentos de incertidumbre, proponiendo soluciones claras
Participa en actividades donde se requiera liderazgo y toma de decisiones
Lee biografías de líderes que tomaron decisiones difíciles con convicción',
  habilidades_clave = E'Decidir | Confiar | Liderar | Guiar | Convencer',
  ojo_con = E'Ignorar retroalimentación podría hacerte parecer arrogante'
WHERE slug = 'auto-seguridad'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'autoseguridad';

UPDATE public.habilidades SET
  slug = 'calidad',
  sort_order = 5,
  descripcion = E'Disposición natural por la excelencia en todo lo que se hace.',
  como_lo_vives = E'No te conformas con lo mínimo. Tienes un impulso constante por mejorar, perfeccionar y alcanzar estándares altos. Buscas excelencia tanto en lo personal como profesional.',
  recomendaciones = E'Establece metas personales y revisa constantemente tu progreso
Busca retroalimentación para mejorar en lo que haces
Participa en proyectos de mejora continua o innovación
Lee sobre buenas prácticas, estándares y casos de éxito
Rodéate de personas que también valoren la excelencia',
  habilidades_clave = E'Mejorar | Perfeccionar | Elevar | Exigir | Controlar',
  ojo_con = E'Ser perfeccionista al punto de no avanzar retrasa los resultados'
WHERE slug = 'calidad'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'calidad';

UPDATE public.habilidades SET
  slug = 'competidor',
  sort_order = 6,
  descripcion = E'Facilidad para buscar el triunfo y destacar frente a los demás.',
  como_lo_vives = E'Propones retos, juegos o competencias. Te gusta saber quién ganó, quién hizo algo mejor. En el trabajo, impulsa a alcanzar metas ambiciosas y contagia a tu equipo con energía por ganar.',
  recomendaciones = E'Participa en competencias deportivas, académicas o laborales
Mide tu progreso con indicadores claros y metas personales
Rodéate de personas que te reten y te impulsen a mejorar
Celebra tus logros y aprende de tus derrotas
Estudia casos de éxito y analiza qué hizo la diferencia',
  habilidades_clave = E'Competir | Ganar | Superar | Medir | Motivar',
  ojo_con = E'Compararte constantemente puede generar tensión en el equipo'
WHERE slug = 'competidor'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'competidor';

UPDATE public.habilidades SET
  slug = 'comprension',
  sort_order = 7,
  descripcion = E'Capacidad natural para conectar con los sentimientos de los demás.',
  como_lo_vives = E'Eres quien nota si alguien no está bien, aunque no lo diga. Preguntas "¿cómo te sientes?" y realmente escuchas. En el trabajo, eres un puente emocional entre personas, equipos y clientes.',
  recomendaciones = E'Practica la escucha activa en conversaciones cotidianas
Haz preguntas que inviten a la reflexión emocional
Lee sobre inteligencia emocional y empatía
Participa en espacios de acompañamiento, voluntariado o mentoría
Observa con atención el lenguaje no verbal de las personas',
  habilidades_clave = E'Escuchar | Entender | Empatizar | Conectar | Acompañar',
  ojo_con = E'Absorber problemas ajenos puede hacerte perder objetividad'
WHERE slug = 'comprension'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'comprension';

UPDATE public.habilidades SET
  slug = 'comunicador',
  sort_order = 8,
  descripcion = E'Transmitir ideas, emociones y mensajes de forma clara, atractiva y convincente.',
  como_lo_vives = E'Cuentas las anécdotas más divertidas, explicas lo que todos piensan pero no saben cómo decirlo. Tienes facilidad para expresarte y captar atención. Eres un vocero natural para presentar ideas y proyectos.',
  recomendaciones = E'Participa en presentaciones, charlas o reuniones donde puedas compartir ideas
Escribe artículos, blogs o contenidos que expresen tu punto de vista
Escucha a otros comunicadores y aprende de sus estilos
Practica la claridad y la empatía en cada conversación
Toma cursos de oratoria, storytelling o comunicación efectiva',
  habilidades_clave = E'Comunicar | Expresar | Conectar | Narrar | Persuadir',
  ojo_con = E'Hablar sin escuchar puede desviar el foco de la conversación'
WHERE slug = 'comunicador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'comunicador';

UPDATE public.habilidades SET
  slug = 'concentracion',
  sort_order = 9,
  descripcion = E'Habilidad para mantener el enfoque en una meta y avanzar hacia ella con disciplina.',
  como_lo_vives = E'Eres quien recuerda que hay que cumplir lo planeado, quien organiza los tiempos y mantiene el rumbo. En el trabajo, eres confiable, cumples compromisos y ayudas al equipo a no perder de vista las prioridades.',
  recomendaciones = E'Establece metas claras y divídelas en etapas alcanzables
Usa herramientas de organización como agendas, calendarios y listas de tareas
Practica la disciplina personal evitando distracciones digitales
Toma pausas estratégicas para mantener la energía y el enfoque
Participa en proyectos donde se requiera seguimiento constante',
  habilidades_clave = E'Enfocarse | Organizar | Priorizar | Disciplinar | Ejecutar',
  ojo_con = E'Aislarte podría hacerte perder de vista el contexto general'
WHERE slug = 'concentracion'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'concentracion';

UPDATE public.habilidades SET
  slug = 'conceptual',
  sort_order = 10,
  descripcion = E'Capacidad natural para resolver problemas complejos y visualizar ideas desde múltiples ángulos.',
  como_lo_vives = E'Propones ideas profundas, teorías interesantes o soluciones creativas a problemas difíciles. Te gusta pensar, analizar y debatir. En el trabajo, eres un gran asesor, estratega o diseñador de soluciones.',
  recomendaciones = E'Participa en proyectos que requieran resolver problemas complejos
Lee sobre filosofía, ciencia, diseño y pensamiento estratégico
Escribe ensayos o artículos que exploren ideas profundas
Toma tiempo para pensar y reflexionar en espacios tranquilos
Rodéate de personas que disfruten el pensamiento abstracto y creativo',
  habilidades_clave = E'Analizar | Pensar | Crear | Integrar | Diseñar',
  ojo_con = E'Desconectarse de lo práctico podría complicar lo simple'
WHERE slug = 'conceptual'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'conceptual';

UPDATE public.habilidades SET
  slug = 'conciliador',
  sort_order = 11,
  descripcion = E'Capacidad natural para poner a las personas de acuerdo y generar armonía.',
  como_lo_vives = E'Cuando surge una discusión, eres quien propone una solución que deje a todos tranquilos. Tienes facilidad para mediar entre opiniones distintas. En el trabajo, eres un facilitador de acuerdos y promotor de colaboración.',
  recomendaciones = E'Participa en actividades donde se requiera mediar entre diferentes intereses
Aprende técnicas de negociación y resolución de conflictos
Observa y escucha activamente antes de proponer soluciones
Facilita reuniones y dinámicas grupales que promuevan la colaboración
Estudia casos de éxito en mediación y liderazgo colaborativo',
  habilidades_clave = E'Mediar | Consensuar | Armonizar | Negociar | Facilitar',
  ojo_con = E'Evitar conflictos necesarios podría debilitar las soluciones'
WHERE slug = 'conciliador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'conciliador';

UPDATE public.habilidades SET
  slug = 'conductor',
  sort_order = 12,
  descripcion = E'Capacidad de generar claridad en medio de la ambigüedad y mover a otros a la acción.',
  como_lo_vives = E'Dices "ya decidamos" o "esto es lo que hay que hacer". No te gusta quedarte en la duda y prefieres aclarar las cosas. En el trabajo, impulsa decisiones, resuelve conflictos y genera movimiento.',
  recomendaciones = E'Practica la confrontación constructiva en conversaciones difíciles
Toma decisiones rápidas en situaciones cotidianas
Lee sobre liderazgo, manejo de conflictos y comunicación asertiva
Asume roles donde se requiera guiar a otros en momentos de ambigüedad
Desarrolla tu capacidad para enfrentar la incertidumbre con confianza',
  habilidades_clave = E'Decidir | Confrontar | Guiar | Aclarar | Dirigir',
  ojo_con = E'Controlar en exceso puede evitar que otros tomen iniciativa'
WHERE slug = 'conductor'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'conductor';

UPDATE public.habilidades SET
  slug = 'confidente',
  sort_order = 13,
  descripcion = E'Capacidad natural para establecer relaciones profundas, duraderas y significativas.',
  como_lo_vives = E'Eres quien escucha con atención, guarda secretos y está presente en los momentos importantes. Eres el amigo que nunca falla. En el trabajo, construyes vínculos sólidos con clientes y compañeros, generando relaciones de largo plazo.',
  recomendaciones = E'Dedica tiempo de calidad a las relaciones importantes
Escucha activamente y sin juicio
Sé constante en los momentos clave de los demás
Participa en actividades que fortalezcan vínculos (mentoría, acompañamiento, voluntariado)
Aprende sobre inteligencia emocional y comunicación empática',
  habilidades_clave = E'Escuchar | Confiar | Conectar | Acompañar | Cuidar',
  ojo_con = E'Involucrarse demasiado podría hacerte perder límites saludables'
WHERE slug = 'confidente'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'confidente';

UPDATE public.habilidades SET
  slug = 'conquistador',
  sort_order = 14,
  descripcion = E'Energía especial que impulsa a estar activo, lograr metas y buscar el siguiente reto.',
  como_lo_vives = E'Propones actividades, organizas salidas, te mantienes ocupado. No te gusta quedarte sin hacer nada. En el trabajo, eres altamente productivo, impulsa resultados y contagia a otros con tu ritmo.',
  recomendaciones = E'Establece metas diarias y semanales que te mantengan enfocado
Mide tus logros y celebra cada avance
Participa en proyectos que requieran constancia y resultados
Rodéate de personas que valoren el trabajo y la productividad
Toma descansos estratégicos para mantener tu energía en alto',
  habilidades_clave = E'Lograr | Movilizar | Conquistar | Persistir | Avanzar',
  ojo_con = E'Pasar por encima de otros o ser impaciente puede afectar relaciones'
WHERE slug = 'conquistador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'conquistador';

UPDATE public.habilidades SET
  slug = 'conviccion',
  sort_order = 15,
  descripcion = E'Capacidad natural para guiarse por principios, valores y una misión personal.',
  como_lo_vives = E'Hablas de temas profundos, defiendes tus ideales, buscas que las decisiones del grupo tengan sentido. Eres quien inspira con palabras y acciones. En el trabajo, eres un referente ético que da dirección a los proyectos.',
  recomendaciones = E'Reflexiona sobre tu misión personal y los valores que te guían
Toma decisiones alineadas con tus principios, incluso en momentos difíciles
Participa en proyectos con impacto social o comunitario
Lee sobre ética, filosofía y liderazgo con propósito
Rodéate de personas que también busquen trascender y vivir con sentido',
  habilidades_clave = E'Conviccionar | Inspirar | Guiar | Principiar | Trascender',
  ojo_con = E'Ser inflexible podría impedir considerar otras perspectivas válidas'
WHERE slug = 'conviccion'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'conviccion';

UPDATE public.habilidades SET
  slug = 'cumplimiento',
  sort_order = 16,
  descripcion = E'Predisposición natural para cumplir con lo prometido, respetar acuerdos y generar confianza.',
  como_lo_vives = E'Llegas puntual, cumples lo que prometes, te tomas en serio los compromisos. Eres el que recuerda lo que se acordó y lo lleva a cabo. En el trabajo, eres confiable, generas credibilidad y estabilidad en los equipos.',
  recomendaciones = E'Lleva una agenda clara y revisa tus compromisos diariamente
Comunica con claridad lo que puedes y no puedes hacer
Aprende técnicas de gestión del tiempo y priorización
Rodéate de personas que valoren la responsabilidad y el compromiso
Reflexiona sobre el impacto positivo de cumplir en la vida de los demás',
  habilidades_clave = E'Cumplir | Honrar | Comprometerse | Organizar | Confiar',
  ojo_con = E'Ser rígido sin adaptarse a cambios podría limitar tu flexibilidad'
WHERE slug = 'cumplimiento'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'cumplimiento';

UPDATE public.habilidades SET
  slug = 'determinacion',
  sort_order = 17,
  descripcion = E'Capacidad natural para persistir en el logro de objetivos y superar obstáculos.',
  como_lo_vives = E'Insistes en terminar lo que empiezas, motivas al grupo a no rendirse. En el trabajo, eres un líder resiliente, capaz de enfrentar retos complejos y llevar a tu equipo al éxito.',
  recomendaciones = E'Establece metas claras y desafiantes, trabajando con constancia para alcanzarlas
Rodéate de personas que te inspiren y te reten a crecer
Aprende de tus errores y conviértelos en oportunidades de mejora
Participa en proyectos que requieran resiliencia y visión a largo plazo
Lee historias de éxito y estudia cómo otros han superado grandes retos',
  habilidades_clave = E'Persistir | Superar | Motivar | Resiliar | Avanzar',
  ojo_con = E'Insistir sin evaluar podría ignorar señales de cambio necesario'
WHERE slug = 'determinacion'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'determinacion';

UPDATE public.habilidades SET
  slug = 'encanto',
  sort_order = 18,
  descripcion = E'Capacidad natural para generar una conexión inmediata con los demás.',
  como_lo_vives = E'Rompes el hielo, haces reír, logras que todos se sientan cómodos. Tienes facilidad para iniciar conversaciones y crear un ambiente de confianza. Tu energía positiva es contagiosa.',
  recomendaciones = E'Practica la escucha activa en conversaciones
Participa en actividades sociales o comunitarias
Toma roles de facilitador en reuniones o grupos
Observa cómo reacciona la gente a tu presencia y ajusta tu comunicación
Aprende técnicas de comunicación emocional y lenguaje corporal positivo',
  habilidades_clave = E'Conectar | Encantar | Atraer | Facilitar | Contagiar',
  ojo_con = E'Buscar aprobación constante podría llevar a superficialidad'
WHERE slug = 'encanto'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'encanto';

UPDATE public.habilidades SET
  slug = 'energizador',
  sort_order = 19,
  descripcion = E'Capacidad para transmitir entusiasmo, vitalidad y energía a los demás.',
  como_lo_vives = E'Propones actividades, animas al grupo, mantienes el ambiente alegre y activo. Con solo llegar, cambias el ánimo del lugar. Sueles motivar a otros a salir, participar o simplemente disfrutar el momento.',
  recomendaciones = E'Participa en dinámicas grupales donde puedas motivar a otros
Escucha música que te inspire y compártela con tu entorno
Organiza actividades recreativas o de integración
Practica el reconocimiento positivo hacia los demás
Toma espacios para recargar tu propia energía y mantener tu vitalidad',
  habilidades_clave = E'Energizar | Motivar | Animar | Contagiar | Activar',
  ojo_con = E'Agotar a otros o no respetar ritmos diferentes puede ser contraproducente'
WHERE slug = 'energizador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'energizador';

UPDATE public.habilidades SET
  slug = 'equitativo',
  sort_order = 20,
  descripcion = E'Capacidad de tratar a las personas con imparcialidad, justicia y respeto.',
  como_lo_vives = E'En una reunión con amigos, eres quien interviene cuando alguien no está siendo escuchado o tratado con justicia. Propones que todos participen por igual y respeten los turnos. Defiendes la equidad y promueves el respeto mutuo.',
  recomendaciones = E'Escucha activamente a personas con diferentes puntos de vista
Participa en actividades donde se promueva la inclusión y el respeto
Observa cómo se toman decisiones en grupo y propone mejoras para que sean más equitativas
Lee sobre justicia social, diversidad e inclusión
Sé voluntario en iniciativas que promuevan la equidad en tu comunidad o trabajo',
  habilidades_clave = E'Equidad | Justicia | Imparcialidad | Respeto | Incluir',
  ojo_con = E'Ser excesivamente rígido podría impedir ver particularidades importantes'
WHERE slug = 'equitativo'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'equitativo';

UPDATE public.habilidades SET
  slug = 'estrategia',
  sort_order = 21,
  descripcion = E'Capacidad de visualizar rutas claras para alcanzar objetivos.',
  como_lo_vives = E'En conversaciones con amigos, eres quien propone cómo organizar el plan, qué ruta tomar para evitar tráfico o cómo aprovechar mejor el tiempo. Tienes facilidad para ver alternativas y elegir la más conveniente.',
  recomendaciones = E'Diseña planes para proyectos personales o laborales
Juega juegos de estrategia como ajedrez o rompecabezas
Analiza decisiones pasadas y evalúa qué rutas fueron efectivas
Participa en sesiones de planeación o lluvia de ideas
Lee sobre pensamiento estratégico y liderazgo',
  habilidades_clave = E'Estrategizar | Visualizar | Anticipar | Planificar | Optimizar',
  ojo_con = E'Sobreplanear sin pasar a la acción podría retrasar resultados'
WHERE slug = 'estrategia'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'estrategia';

UPDATE public.habilidades SET
  slug = 'examinador',
  sort_order = 22,
  descripcion = E'Capacidad de observar con profundidad, analizar con detalle y detectar inconsistencias.',
  como_lo_vives = E'Eres quien nota los detalles que otros pasan por alto. Puedes detectar contradicciones, haces preguntas que invitan a reflexionar. Los demás te piden tu opinión cuando necesitan una mirada objetiva y precisa.',
  recomendaciones = E'Revisa documentos, procesos o productos con ojo crítico
Participa en comités de evaluación o mejora continua
Haz listas de verificación para asegurar calidad
Lee con atención y busca inconsistencias o áreas de mejora
Da retroalimentación constructiva en equipos de trabajo',
  habilidades_clave = E'Examinar | Analizar | Cuestionar | Evaluar | Mejorar',
  ojo_con = E'Cuestionar todo podría frenar decisiones importantes'
WHERE slug = 'examinador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'examinador';

UPDATE public.habilidades SET
  slug = 'grandeza',
  sort_order = 23,
  descripcion = E'Capacidad de buscar dejar huella, inspirar y transformar.',
  como_lo_vives = E'No solo propones ideas, sino que elevas la conversación conectando el proyecto con un propósito mayor. En casa, motivas a tu familia a celebrar logros. Con amigos, recuerdas lo valioso de cada momento compartido, dándole profundidad a lo cotidiano.',
  recomendaciones = E'Inspira a otros con acciones coherentes y significativas
Participa en proyectos con impacto social o cultural
Cuida la forma en que te comunicas y representas a tu equipo
Reflexiona sobre el legado que quieres dejar
Eleva el estándar de calidad y ética en tu entorno',
  habilidades_clave = E'Inspirar | Elevar | Transcender | Transformar | Legado',
  ojo_con = E'Desconectarse de lo realista podría generar frustración'
WHERE slug = 'grandeza'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'grandeza';

UPDATE public.habilidades SET
  slug = 'incluyente',
  sort_order = 24,
  descripcion = E'Capacidad de integrar a las personas, valorar la diversidad y crear espacios donde todos se sientan bienvenidos.',
  como_lo_vives = E'En una reunión de trabajo, eres quien nota que alguien no ha participado y le da espacio para compartir su opinión. En casa, te aseguras de que todos se sientan escuchados. Con amigos, integras a nuevos miembros al grupo, cuidando que nadie se sienta fuera.',
  recomendaciones = E'Observa quién no está participando y facilita su inclusión
Escucha activamente sin prejuicios
Promueve espacios de diálogo y colaboración
Aprende sobre diversidad, equidad e inclusión
Reconoce y valora las diferencias como fuente de riqueza',
  habilidades_clave = E'Incluir | Integrar | Conectar | Facilitar | Valorar',
  ojo_con = E'Diluir decisiones buscando consenso excesivo podría debilitar resultados'
WHERE slug = 'incluyente'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'incluyente';

UPDATE public.habilidades SET
  slug = 'indagador',
  sort_order = 25,
  descripcion = E'Curiosidad natural que impulsa a investigar, conectar ideas y profundizar en temas complejos.',
  como_lo_vives = E'Siempre estás preguntando "¿y si lo hacemos diferente?", "¿por qué se hace así?". Lo encontrarás investigando antes de tomar una decisión, comparando opciones o buscando el origen de un problema. Haces preguntas profundas que hacen que todos se queden pensando.',
  recomendaciones = E'Lee sobre temas diversos y complejos
Formula preguntas en reuniones o conversaciones
Investiga causas y consecuencias antes de tomar decisiones
Participa en proyectos de análisis o diagnóstico
Comparte hallazgos y aprendizajes con tu equipo',
  habilidades_clave = E'Indagar | Investigar | Cuestionar | Profundizar | Descubrir',
  ojo_con = E'Interrogar en exceso podría parecer desconfianza'
WHERE slug = 'indagador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'indagador';

UPDATE public.habilidades SET
  slug = 'ingenioso',
  sort_order = 26,
  descripcion = E'Facilidad para encontrar soluciones creativas, prácticas y efectivas ante cualquier situación.',
  como_lo_vives = E'Siempre tienes una solución creativa bajo la manga. Dices frases como "¿y si usamos esto en lugar de aquello?" o "podría funcionar así". Propones ideas inesperadas que simplifican lo complejo. Improviesas soluciones con lo que tienes a mano.',
  recomendaciones = E'Participa en retos creativos o dinámicas de innovación
Busca inspiración en diferentes disciplinas o contextos
Practica la improvisación en escenarios reales o simulados
Comparte ideas con personas de perfiles diversos
Documenta las soluciones creativas que has aplicado',
  habilidades_clave = E'Crear | Innovar | Simplificar | Adaptar | Resolver',
  ojo_con = E'Proponer sin ejecutar podría dispersar los esfuerzos'
WHERE slug = 'ingenioso'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'ingenioso';

UPDATE public.habilidades SET
  slug = 'mentor',
  sort_order = 27,
  descripcion = E'Habilidad de guiar, acompañar y potenciar el desarrollo de otras personas.',
  como_lo_vives = E'Seguramente lo escucharás diciendo: "cuenta conmigo", "¿cómo te puedo ayudar?", o "yo ya pasé por eso, te comparto lo que aprendí". Escuchas con paciencia, das consejos sin imponer y celebras los avances de los demás como si fueran propios.',
  recomendaciones = E'Escucha activamente sin interrumpir ni juzgar
Comparte experiencias personales que puedan inspirar
Ofrece retroalimentación constructiva y empática
Acompaña procesos de aprendizaje o cambio
Formáte en herramientas de desarrollo humano y comunicación efectiva',
  habilidades_clave = E'Mentorar | Guiar | Desarrollar | Acompañar | Inspirar',
  ojo_con = E'Sobreproteger podría impedir que otros crezcan de forma independiente'
WHERE slug = 'mentor'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'mentor';

UPDATE public.habilidades SET
  slug = 'momento',
  sort_order = 28,
  descripcion = E'Capacidad de vivir con plena conciencia del presente y detectar oportunidades en tiempo real.',
  como_lo_vives = E'Dices cosas como "espera, este no es el momento", "ahora sí, es cuando hay que entrar", o "déjalo, ya se acomodará solo". Lees el ambiente antes de hablar, esperas el instante justo para actuar o sabes cuándo retirarte. En una reunión, interviens justo cuando tu equipo necesita claridad.',
  recomendaciones = E'Practica la atención plena (mindfulness) en tareas diarias
Observa el entorno antes de tomar decisiones
Participa en dinámicas que requieren reacción rápida
Reflexiona sobre momentos clave en los que has intervenido con éxito
Aprende a confiar en tu intuición y afinar tu percepción del contexto',
  habilidades_clave = E'Percibir | Actuar | Intuir | Intervenir | Timing',
  ojo_con = E'Ser impulsivo sin prever consecuencias podría afectar resultados'
WHERE slug = 'momento'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'momento';

UPDATE public.habilidades SET
  slug = 'operador',
  sort_order = 29,
  descripcion = E'Ejecutar con precisión, mantener el orden operativo y asegurar que las tareas se realicen de manera eficiente.',
  como_lo_vives = E'Dices cosas como "ya lo tengo listo", "¿qué sigue?", o "déjamelo a mí, yo lo hago". Te encarga organizar tareas, cumplir con tiempos y asegurar que todo esté funcionando como debe. En casa, llevas el control de pagos o armas la rutina familiar.',
  recomendaciones = E'Crea y sigue rutinas de trabajo eficientes
Usa herramientas de organización como agendas, listas o tableros
Participa en procesos operativos que requieran precisión
Documenta procedimientos para asegurar consistencia
Capacítate en metodologías de mejora continua y gestión operativa',
  habilidades_clave = E'Ejecutar | Organizar | Coordinar | Controlar | Asegurar',
  ojo_con = E'Ser mecánico sin innovar podría resistirse a cambios necesarios'
WHERE slug = 'operador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'operador';

UPDATE public.habilidades SET
  slug = 'perfeccionista',
  sort_order = 30,
  descripcion = E'Quién se encarga de cuidar los detalles, mantener altos estándares de calidad.',
  como_lo_vives = E'En el trabajo dices "Déjame revisar una vez más antes de enviarlo". En casa, estás acomodando los cuadros milimétricamente o limpiando lo que ya está limpio. Con amigos, hiciste el itinerario con tiempos de traslado y opciones de comida. Siempre afinando detalles.',
  recomendaciones = E'Revisa tu trabajo antes de entregarlo, buscando errores o áreas de mejora
Establece estándares claros de calidad para tus tareas
Pide retroalimentación para mejorar tus entregables
Capacítate en metodologías de mejora continua
Documenta buenas prácticas y aplícalas de forma consistente',
  habilidades_clave = E'Perfeccionar | Pulir | Revisar | Detallar | Elevar',
  ojo_con = E'No soltar tareas o retrasar entregas por buscar la perfección'
WHERE slug = 'perfeccionista'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'perfeccionista';

UPDATE public.habilidades SET
  slug = 'personalizador',
  sort_order = 31,
  descripcion = E'Capacidad de reconocer la individualidad de cada persona y adaptar las interacciones según sus características únicas.',
  como_lo_vives = E'Notas lo que hace único a cada quien. En el trabajo dices "A ella le funciona mejor con ejemplos visuales". En casa, eliges regalos pensados en los gustos de cada persona. Con amigos, adaptas los planes según quién va. Siempre buscas que cada persona se sienta vista y valorada.',
  recomendaciones = E'Escucha activamente para entender las necesidades individuales
Observa estilos de comunicación y adapta el propio
Diseña experiencias o soluciones ajustadas a distintos perfiles
Aprende sobre diversidad, inclusión y estilos de personalidad
Practica la empatía en contextos personales y laborales',
  habilidades_clave = E'Personalizar | Adaptar | Empathizar | Reconocer | Incluir',
  ojo_con = E'Perder objetividad o complicar procesos por adaptarlos demasiado'
WHERE slug = 'personalizador'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'personalizador';

UPDATE public.habilidades SET
  slug = 'prudencial',
  sort_order = 32,
  descripcion = E'Capacidad de pensar antes de actuar, evaluar riesgos y tomar decisiones con cautela.',
  como_lo_vives = E'Piensas antes de actuar. En el trabajo preguntas "¿Ya analizamos los riesgos?". En casa, evitas decisiones impulsivas: "Mejor lo hablamos con calma". Con amigos, frenas ideas apresuradas: "¿Y si lo planeamos bien antes de lanzarnos?". Siempre buscas proteger y prevenir.',
  recomendaciones = E'Tómate tiempo para reflexionar antes de decidir
Consulta diferentes fuentes de información antes de actuar
Evalúa pros y contras de cada opción
Aprende de experiencias pasadas para anticipar riesgos
Practica la escucha activa y la observación antes de intervenir',
  habilidades_clave = E'Prevenir | Evaluar | Reflexionar | Cuidar | Anticipar',
  ojo_con = E'La parálisis por precaución podría hacer perder oportunidades'
WHERE slug = 'prudencial'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'prudencial';

UPDATE public.habilidades SET
  slug = 'reconstructor',
  sort_order = 33,
  descripcion = E'Capacidad de restaurar, reparar y transformar tomando la información o recursos disponibles.',
  como_lo_vives = E'Ves posibilidades donde otros ven restos. En el trabajo dices "Con estos datos podemos armar algo útil". En casa, rescatas objetos o recuerdos: "Esto tiene historia, déjame darle nueva vida". Con amigos, conectas experiencias pasadas para darles sentido.',
  recomendaciones = E'Participa en procesos de mejora continua
Escucha activamente para entender el origen de los problemas
Diseña planes de acción para restaurar lo dañado
Aprende sobre gestión del cambio y resiliencia',
  habilidades_clave = E'Restaurar | Reparar | Resignificar | Reconstruir | Transformar',
  ojo_con = E'Ver fallas en todo podría generar una actitud negativa'
WHERE slug = 'reconstructor'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'reconstructor';

UPDATE public.habilidades SET
  slug = 'sistematico',
  sort_order = 34,
  descripcion = E'Capacidad de organizar, estructurar y ejecutar tareas de manera ordenada y lógica.',
  como_lo_vives = E'Ordenas el caos con lógica. En el trabajo dices "¿Cuál es el proceso? Vamos paso por paso". En casa, tienes rutinas claras: "Los domingos son para limpiar y planear la semana". Con amigos, organizas salidas con estructura. Siempre buscas claridad, orden y eficiencia.',
  recomendaciones = E'Crea listas, cronogramas y flujos de trabajo
Documenta procesos para facilitar su repetición
Evalúa y mejora sistemas existentes
Usa herramientas digitales de organización y gestión
Comparte buenas prácticas de orden y planeación con tu equipo',
  habilidades_clave = E'Sistematizar | Estructurar | Organizar | Ordenar | Procesar',
  ojo_con = E'Ser inflexible al rechazar cambios podría limitar innovación'
WHERE slug = 'sistematico'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'sistematico';

UPDATE public.habilidades SET
  slug = 'visionario',
  sort_order = 35,
  descripcion = E'Capacidad de imaginar futuros posibles, anticipar tendencias y conectar el presente con una visión inspiradora.',
  como_lo_vives = E'Ves más allá del presente. En el trabajo dices "Esto puede crecer si lo pensamos a largo plazo". En casa, hablas de ideas futuras: "Imagínate si convertimos este espacio en un estudio". Con amigos, lanzas propuestas audaces: "¿Y si hacemos algo diferente este año?". Siempre imaginando posibilidades.',
  recomendaciones = E'Lee sobre tendencias, innovación y pensamiento estratégico
Imagina escenarios futuros y compártelos con otros
Participa en espacios de planeación y diseño de futuro
Conecta ideas de distintas disciplinas para generar nuevas propuestas
Inspira a otros con narrativas que proyecten posibilidades',
  habilidades_clave = E'Visionar | Imaginar | Anticipar | Inspirar | Transformar',
  ojo_con = E'Desconectarse del presente podría generar frustración'
WHERE slug = 'visionario'
   OR lower(regexp_replace(translate(nombre, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'), '[^a-zA-Z0-9]', '', 'g')) = 'visionario';

-- PASO 3: verificación
SELECT count(*) FILTER (WHERE descripcion IS NOT NULL AND descripcion <> '') AS con_descripcion,
       count(*) AS total
FROM public.habilidades;
SELECT sort_order, nombre, slug, left(descripcion, 50) AS descripcion_preview
FROM public.habilidades
ORDER BY sort_order NULLS LAST, nombre;