import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-track',
  template: `
    <p>
      track works! {{value}}
    </p>
  `,
  styles: [
  ]
})
export class TrackComponent {

  @Input() value: 'X' | 'O' = 'X';

}
