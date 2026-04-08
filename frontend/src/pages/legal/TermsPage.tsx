export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white">
        Términos y Condiciones
      </h1>
      <p className="mt-2 text-sm text-surface-500">Última actualización: abril de 2026</p>

      <div className="prose prose-surface dark:prose-invert mt-8 max-w-none text-sm leading-7">

        <h2>1. Aceptación de los Términos</h2>
        <p>
          Al registrarte y usar Nexo Fitness (la "Plataforma"), aceptas quedar vinculado por
          estos Términos y Condiciones. Si no estás de acuerdo con alguno de ellos, no debes
          usar la Plataforma.
        </p>

        <h2>2. Descripción del Servicio</h2>
        <p>
          Nexo Fitness es una plataforma SaaS (Software as a Service) que permite a gimnasios y
          centros deportivos gestionar clientes, membresías, clases, pagos y comunicaciones.
          También ofrece una aplicación web progresiva (PWA) para que los miembros de cada
          gimnasio accedan a sus datos y reservas.
        </p>

        <h2>3. Registro y Cuenta</h2>
        <p>
          Para usar la Plataforma debes registrarte proporcionando información veraz y actualizada.
          Eres responsable de mantener la confidencialidad de tus credenciales y de toda la
          actividad que ocurra bajo tu cuenta.
        </p>
        <p>
          Te comprometemos a notificarnos de inmediato ante cualquier uso no autorizado de tu cuenta.
        </p>

        <h2>4. Plan de Prueba (Trial)</h2>
        <p>
          Los nuevos usuarios tienen acceso a un período de prueba gratuita de 14 días. Transcurrido
          ese período, el acceso se suspende hasta que se active una suscripción paga. Los datos
          almacenados durante el trial se conservan por un período adicional de 30 días tras la
          expiración.
        </p>

        <h2>5. Suscripciones y Pagos</h2>
        <p>
          Las suscripciones se cobran mensual o anualmente, según el plan elegido. Los precios
          vigentes se muestran en la página de planes en el momento del registro.
        </p>
        <p>
          Los pagos son procesados por proveedores externos (Stripe, MercadoPago, Fintoc). Nexo
          Fitness no almacena datos de tarjetas de crédito.
        </p>
        <p>
          Las suscripciones se renuevan automáticamente al final de cada período a menos que sean
          canceladas con anterioridad.
        </p>

        <h2>6. Política de Reembolso</h2>
        <p>
          Las suscripciones no son reembolsables salvo que la ley aplicable lo exija. Si tienes
          algún problema con el servicio, contáctanos y evaluaremos cada caso individualmente.
        </p>

        <h2>7. Uso Aceptable</h2>
        <p>Te comprometes a no:</p>
        <ul>
          <li>Usar la Plataforma para fines ilegales o no autorizados.</li>
          <li>Intentar acceder a datos de otros tenants o usuarios.</li>
          <li>Introducir malware o interferir con la seguridad de la Plataforma.</li>
          <li>Revender, sublicenciar o transferir el acceso a terceros sin autorización expresa.</li>
        </ul>

        <h2>8. Propiedad Intelectual</h2>
        <p>
          Nexo Fitness y todos sus componentes (código, diseño, marca) son propiedad exclusiva de
          sus desarrolladores. Los datos que ingreses a la Plataforma (clientes, pagos, clases) son
          de tu propiedad y puedes exportarlos en cualquier momento.
        </p>

        <h2>9. Privacidad</h2>
        <p>
          El tratamiento de datos personales se rige por nuestra{' '}
          <a href="/privacy" className="text-brand-600 hover:underline dark:text-brand-400">
            Política de Privacidad
          </a>
          .
        </p>

        <h2>10. Limitación de Responsabilidad</h2>
        <p>
          En la máxima medida permitida por la ley, Nexo Fitness no será responsable por daños
          indirectos, incidentales, especiales o consecuentes derivados del uso o la imposibilidad
          de uso de la Plataforma.
        </p>

        <h2>11. Modificaciones</h2>
        <p>
          Nos reservamos el derecho de modificar estos Términos en cualquier momento. Los cambios
          sustanciales serán notificados por email con al menos 15 días de anticipación. El uso
          continuado de la Plataforma implica la aceptación de los nuevos Términos.
        </p>

        <h2>12. Ley Aplicable</h2>
        <p>
          Estos Términos se rigen por las leyes de Chile. Cualquier disputa será sometida a los
          tribunales ordinarios de justicia de la ciudad de Santiago de Chile.
        </p>

        <h2>13. Contacto</h2>
        <p>
          Si tienes preguntas sobre estos Términos, escríbenos a{' '}
          <a href="mailto:legal@nexofitness.com" className="text-brand-600 hover:underline dark:text-brand-400">
            legal@nexofitness.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
